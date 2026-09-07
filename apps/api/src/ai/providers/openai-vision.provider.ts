import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import OpenAI from "openai";

import { buildInBodyExtractionPrompt } from "./inbody-extraction-prompt";
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
 * Model: `gpt-4o-mini`, chosen for cost -- the cheapest OpenAI model confirmed to support
 * image input via the standard chat completions API at the time this was written
 * ($0.15 / 1M input tokens, $0.60 / 1M output tokens). OpenAI's pricing page changes
 * frequently and was not fully trustworthy to automated verification during this session
 * (some fetched model names could not be corroborated); if a cheaper vision-capable model is
 * confirmed later, this is the one line to change.
 */
@Injectable()
export class OpenAiVisionProvider implements VisionProvider {
  private static readonly MODEL = "gpt-4o-mini";
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
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        });

        const text = response.choices[0]?.message?.content;
        if (!text) {
          lastError = new Error("no content in vision model response");
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
