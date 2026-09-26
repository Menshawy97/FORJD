import { Inject, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import OpenAI from "openai";

import { buildInBodyExtractionPrompt } from "./inbody-extraction-prompt";
import { buildInBodyExtractionSchema } from "./inbody-extraction-schema";
import { parseInBodyExtractionResponse } from "./inbody-response-parser";
import { OPENAI_VISION_CLIENT } from "./openai-vision-client";
import type { ExtractedBodyScan, VisionProvider } from "./vision-provider.interface";

/**
 * The production InBody vision-extraction vendor (ADR-032's deferred decision, now taken).
 * NVIDIA (`nvidia-vision.provider.ts`) remains in the tree as a development-only option --
 * its Trial Terms of Service forbid production use of real users' health data -- but this
 * file is what `AiModule` now binds `VISION_PROVIDER` to.
 *
 * Reuses the exact same prompt and response parser NVIDIA's provider does
 * (`inbody-extraction-prompt.ts` / `inbody-response-parser.ts`), which is the whole reason
 * those two were pulled out of `nvidia-vision.provider.ts` in the first place: ADR-032 named
 * "a new file implementing VisionProvider" as the cost of switching vendors, not a rewrite
 * of the extraction logic. The golden fixtures in `tests/fixtures/inbody/` therefore already
 * cover this file's prompt and parsing behaviour.
 *
 * Model: `gpt-5.4-mini` (ADR-053), chosen by measuring against the hand-checked sample sheets
 * in `scripts/spikes/inbody-samples/`: 88-91% of values exactly right with this prompt, against
 * 51-59% for the previous `gpt-4o-mini`, at about the same cost per scan (~$0.005 -- older
 * models are billed far more tokens per image) and ~4 s per scan. `detail: "high"` because
 * InBody sheets are dense small print, and a strict JSON schema (`response_format`) so the
 * answer is always well-formed; the retry loop below still covers transport failures.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class OpenAiVisionProvider implements VisionProvider {
  private static readonly MODEL = "gpt-5.4-mini";
  /** Generous: the answer is ~600 tokens, and a truncated JSON answer is a failed scan. */
  private static readonly MAX_COMPLETION_TOKENS = 4096;
  private static readonly MAX_ATTEMPTS = 3;
  /**
   * One budget for every attempt together (8.5 S9, L7-1). Three back-to-back 30 s attempts
   * could hold a request, and a Cloud Run instance slot, for ~90 s.
   */
  private static readonly TOTAL_BUDGET_MS = 45_000;
  /** The client's own timeout (`openai-vision-client.ts`); a later attempt gets what is left. */
  private static readonly ATTEMPT_TIMEOUT_MS = 30_000;
  /** The wait before the second attempt, doubled before the third, so a busy vendor can recover. */
  private static readonly FIRST_BACKOFF_MS = 1_000;
  /** A normal scan takes ~4 s; with less than this left, another attempt is not worth starting. */
  private static readonly MIN_ATTEMPT_MS = 5_000;

  private readonly logger = new Logger(OpenAiVisionProvider.name);

  constructor(@Inject(OPENAI_VISION_CLIENT) private readonly client: OpenAI) {}

  async extractBodyScan(image: Buffer, mimeType: string): Promise<ExtractedBodyScan> {
    const body = this.requestBody(`data:${mimeType};base64,${image.toString("base64")}`);
    const deadline = Date.now() + OpenAiVisionProvider.TOTAL_BUDGET_MS;

    let lastError: unknown;
    let attemptsMade = 0;
    for (let attempt = 1; attempt <= OpenAiVisionProvider.MAX_ATTEMPTS; attempt++) {
      const backoff = attempt === 1 ? 0 : OpenAiVisionProvider.FIRST_BACKOFF_MS * 2 ** (attempt - 2);
      // Checked before waiting, so the wait itself never runs the request past its budget.
      if (deadline - Date.now() - backoff < OpenAiVisionProvider.MIN_ATTEMPT_MS) break;
      if (backoff > 0) await delay(backoff);
      const remaining = deadline - Date.now();
      attemptsMade = attempt;

      try {
        const response = await this.client.chat.completions.create(body, {
          timeout: Math.min(OpenAiVisionProvider.ATTEMPT_TIMEOUT_MS, remaining),
        });

        const choice = response.choices[0];
        const text = choice?.message?.content;
        if (!text) {
          // "length" means the model spent its token allowance (reasoning counts against it)
          // before answering -- a budget problem, not a transport one, so the log says which.
          lastError = new Error(`no content in vision model response (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
          continue;
        }

        return parseInBodyExtractionResponse(text);
      } catch (err) {
        lastError = err;
      }
    }

    // The real cause stays in the server log. The vendor's wording never reaches the app, which
    // shows its own "could not read that photo" message on any failure (8.5 S9, L7-2).
    this.logger.error(
      `Vision extraction failed after ${attemptsMade} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
    throw new InternalServerErrorException("Could not read the scan. Please try again.");
  }

  private requestBody(dataUrl: string): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    return {
      model: OpenAiVisionProvider.MODEL,
      max_completion_tokens: OpenAiVisionProvider.MAX_COMPLETION_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: { name: "inbody_extraction", strict: true, schema: buildInBodyExtractionSchema() },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildInBodyExtractionPrompt() },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    };
  }
}
