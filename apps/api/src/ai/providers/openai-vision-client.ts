import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

/**
 * The client OpenAiVisionProvider speaks through, bound separately from the adapter itself
 * so tests can substitute a stub -- same fix, same reasoning, as `nvidia-vision-client.ts`
 * and `supabase-storage-client.ts` (ADR-011): a provider that constructs its own client is
 * verifiable only by hand against a live vendor.
 */
export const OPENAI_VISION_CLIENT = Symbol("OPENAI_VISION_CLIENT");

export function createOpenAiVisionClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

export const openAiVisionClientProvider: Provider = {
  provide: OPENAI_VISION_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): OpenAI => createOpenAiVisionClient(config.getOrThrow<string>("OPENAI_API_KEY")),
};
