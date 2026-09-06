import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import OpenAI from "openai";
import { BODY_METRICS, type BodyMetric } from "@forjd/domain";

import { NVIDIA_VISION_CLIENT } from "./nvidia-vision-client";
import type { ExtractedBodyScan, ExtractedMeasurement, VisionProvider } from "./vision-provider.interface";

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
 * Model choice (meta/llama-3.2-11b-vision-instruct) and every prompt decision below --
 * showing a filled example rather than the abstract JSON schema, deliberately varying the
 * example's confidence values, keeping the rules list short, retrying rather than trusting
 * one attempt -- were each verified against the live API during Spike B's build; see
 * scripts/spikes/inbody-vision.ts and its README for the failure each one fixes. This is
 * not a rewrite of that logic, it is the same logic with @forjd/domain's BodyMetric keys
 * instead of the spike's own field names (which happen to already match exactly).
 */
@Injectable()
export class NvidiaVisionProvider implements VisionProvider {
  private static readonly MODEL = "meta/llama-3.2-11b-vision-instruct";
  private static readonly MAX_ATTEMPTS = 3;
  /** The exact international avoirdupois pound, in kilograms -- the same constant
   *  packages/domain/src/unit-conversion.ts uses (KG_PER_LB). */
  private static readonly KG_PER_LB = 0.45359237;

  constructor(@Inject(NVIDIA_VISION_CLIENT) private readonly client: OpenAI) {}

  async extractBodyScan(image: Buffer, mimeType: string): Promise<ExtractedBodyScan> {
    const dataUrl = `data:${mimeType};base64,${image.toString("base64")}`;
    const prompt = this.buildPrompt();

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

        return this.parseResponse(text);
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

  private buildPrompt(): string {
    const example = {
      inbody_model: "570",
      test_date: "2026-01-15",
      fields: Object.fromEntries(
        BODY_METRICS.map((metric, i) => [
          metric,
          {
            value: 10 + i * 7.3,
            confidence: [0.99, 0.62, 0.85, 0.97, 0.71, 0.9, 0.55, 0.93, 0.8][i],
            reading_note: "",
          },
        ]),
      ),
      image_quality_notes: "",
    };

    return `This is a photograph of an InBody body-composition result sheet. InBody
machines print weight-related fields (Weight, Skeletal Muscle Mass, Body Fat Mass) in
either kg OR lb depending on the machine's configured unit — never assume which.

Read these values, converting to the units below if the sheet prints a different unit:
- Weight (kg) — if the sheet shows lb, multiply by ${NvidiaVisionProvider.KG_PER_LB} to get kg.
- Skeletal Muscle Mass (kg) — same lb-to-kg conversion if needed.
- Body Fat Mass (kg) — same lb-to-kg conversion if needed.
- Percent Body Fat (%)
- Visceral Fat Level
- Total Body Water (L)
- BMI
- Basal Metabolic Rate (kcal)
- InBody Score

Rules:
- Transcribe only what is printed. Never compute or infer a value from the others.
- If a field is not on this sheet or you cannot read it, set value to null.
- If you converted a value from lb to kg, say so in reading_note.
- Never report an lb number as if it were kg.
- A conversion is not a reason for value to be null. If the sheet printed lb, you can
  read the number, and you know the conversion factor: multiply it out and report the
  resulting kg number as value. Only use null when you cannot read the printed number at
  all — never as a way to avoid doing the multiplication.
- Set confidence honestly, per field.

Respond with ONLY a JSON object shaped exactly like this example, nothing else.
Every number in this example is fake filler from an unrelated sheet:

${JSON.stringify(example, null, 2)}`;
  }

  /** Tolerates a markdown code fence or prose wrapping around the JSON object -- verified
   *  against the live API to be necessary even with an otherwise-correct prompt. */
  private extractJson(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error("no JSON object found in response");
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }

  private parseResponse(text: string): ExtractedBodyScan {
    const raw = this.extractJson(text) as {
      inbody_model?: unknown;
      test_date?: unknown;
      fields?: Record<string, { value?: unknown; confidence?: unknown; reading_note?: unknown }>;
      image_quality_notes?: unknown;
    };

    const fields = {} as Record<BodyMetric, ExtractedMeasurement>;
    for (const metric of BODY_METRICS) {
      const rawField = raw.fields?.[metric];
      const value = typeof rawField?.value === "number" ? rawField.value : null;
      const confidence = typeof rawField?.confidence === "number" ? rawField.confidence : 0;
      const readingNote = typeof rawField?.reading_note === "string" ? rawField.reading_note : "";
      fields[metric] = { value, confidence, readingNote };
    }

    return {
      inbodyModel: typeof raw.inbody_model === "string" ? raw.inbody_model : null,
      testDate: typeof raw.test_date === "string" ? raw.test_date : null,
      fields,
      imageQualityNotes: typeof raw.image_quality_notes === "string" ? raw.image_quality_notes : "",
    };
  }
}
