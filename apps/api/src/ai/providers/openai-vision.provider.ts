import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
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
@Injectable()
export class OpenAiVisionProvider implements VisionProvider {
  private static readonly MODEL = "gpt-5.4-mini";
  /** Generous: the answer is ~600 tokens, and a truncated JSON answer is a failed scan. */
  private static readonly MAX_COMPLETION_TOKENS = 4096;
  private static readonly MAX_ATTEMPTS = 3;

  constructor(@Inject(OPENAI_VISION_CLIENT) private readonly client: OpenAI) {}

  async extractBodyScan(image: Buffer, mimeType: string): Promise<ExtractedBodyScan> {
    const dataUrl = `data:${mimeType};base64,${image.toString("base64")}`;
    const prompt = buildInBodyExtractionPrompt();

    let lastError: unknown;
    for (let attempt = 1; attempt <= OpenAiVisionProvider.MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
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
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
              ],
            },
          ],
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

    throw new InternalServerErrorException(
      `Vision extraction failed after ${OpenAiVisionProvider.MAX_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
