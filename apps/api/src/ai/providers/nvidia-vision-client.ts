import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

/**
 * The client NvidiaVisionProvider speaks through, bound separately from the adapter itself
 * so tests can substitute a stub -- same fix, same reasoning, as `supabase-storage-client.ts`
 * and `supabase-auth-client.ts` (ADR-011): a provider that constructs its own client is
 * verifiable only by hand against a live vendor. NVIDIA's API is OpenAI-compatible, so this
 * is the `openai` SDK pointed at a different baseURL, not a bespoke NVIDIA client.
 */
export const NVIDIA_VISION_CLIENT = Symbol("NVIDIA_VISION_CLIENT");

export function createNvidiaVisionClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: "https://integrate.api.nvidia.com/v1" });
}

export const nvidiaVisionClientProvider: Provider = {
  provide: NVIDIA_VISION_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): OpenAI =>
    createNvidiaVisionClient(config.getOrThrow<string>("NVIDIA_API_KEY")),
};
