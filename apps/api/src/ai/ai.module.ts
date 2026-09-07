import { Module } from "@nestjs/common";

import { VISION_PROVIDER } from "./providers/vision-provider.interface";
import { openAiVisionClientProvider } from "./providers/openai-vision-client";
import { OpenAiVisionProvider } from "./providers/openai-vision.provider";

/**
 * Phase 5's first consumer of AI. Same module shape as StorageModule -- one symbol
 * exported, the concrete vendor an implementation detail behind it.
 *
 * Bound to OpenAI (production, ADR-032's deferred decision, now taken) rather than NVIDIA
 * (development-only per its own Trial Terms of Service). Switching back, or to a third
 * vendor, is changing this binding alone -- no caller of VISION_PROVIDER changes.
 */
@Module({
  providers: [openAiVisionClientProvider, { provide: VISION_PROVIDER, useClass: OpenAiVisionProvider }],
  exports: [VISION_PROVIDER],
})
export class AiModule {}
