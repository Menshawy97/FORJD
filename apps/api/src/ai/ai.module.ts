import { Module } from "@nestjs/common";

import { VISION_PROVIDER } from "./providers/vision-provider.interface";
import { nvidiaVisionClientProvider } from "./providers/nvidia-vision-client";
import { NvidiaVisionProvider } from "./providers/nvidia-vision.provider";

/**
 * Phase 5's first consumer of AI. Same module shape as StorageModule -- one symbol
 * exported, the concrete vendor an implementation detail behind it.
 */
@Module({
  providers: [nvidiaVisionClientProvider, { provide: VISION_PROVIDER, useClass: NvidiaVisionProvider }],
  exports: [VISION_PROVIDER],
})
export class AiModule {}
