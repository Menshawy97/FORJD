import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import OpenAI from "openai";

import { buildInBodyExtractionPrompt } from "./inbody-extraction-prompt";
import { parseInBodyExtractionResponse } from "./inbody-response-parser";
import { NVIDIA_VISION_CLIENT } from "./nvidia-vision-client";
import type { ExtractedBodyScan, VisionProvider } from "./vision-provider.interface";

/**
 * The only file in apps/api permitted to import an AI vendor SDK (enforced by
 * check-architecture-conformance.sh, mirroring the Supabase-SDK rule for storage/auth).
 *
 * NVIDIA is the development-only vendor -- ADR-032 -- chosen because it's free and the
 * user already had a key, NOT because it was measured as production-ready. Their Trial
 * Terms of Service forbid uploading identifiable health information on the free tier and
 * record inputs to train their models. This must not be the production vendor without a
 * paid tier or a vendor switch (OpenAI is the one ADR-014/ADR-032 name as the eventual
 * choice) revisited first.
 *
 * The prompt and response-parsing logic live in inbody-extraction-prompt.ts and
 * inbody-response-parser.ts -- neither is NVIDIA-specific, so an eventual OpenAI provider
 * reuses both (and the golden fixtures in tests/fixtures/inbody/ that pin them) instead of
 * copying them. This file owns only the vendor call itself: the OpenAI-compatible client,
 * the retry loop, and the data-URL construction. Model choice
 * (meta/llama-3.2-11b-vision-instruct) and the retry count were both verified against the
 * live API during Spike B's build; see scripts/spikes/inbody-vision.ts and its README for
 * the failure each one fixes.
 */
@Injectable()
export class NvidiaVisionProvider implements VisionProvider {
  private static readonly MODEL = "meta/llama-3.2-11b-vision-instruct";
  private static readonly MAX_ATTEMPTS = 3;

  constructor(@Inject(NVIDIA_VISION_CLIENT) private readonly client: OpenAI) {}

  async extractBodyScan(image: Buffer, mimeType: string): Promise<ExtractedBodyScan> {
    const dataUrl = `data:${mimeType};base64,${image.toString("base64")}`;
    const prompt = buildInBodyExtractionPrompt();

    let lastError: unknown;
    for (let attempt = 1; attempt <= NvidiaVisionProvider.MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: NvidiaVisionProvider.MODEL,
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
      `Vision extraction failed after ${NvidiaVisionProvider.MAX_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
