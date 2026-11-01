import OpenAI from "openai";
import { z } from "zod";
import type { ParsedReceipt } from "@splitbot/shared";
import { normalizeCurrencyCode } from "@splitbot/shared";

const parsedReceiptSchema = z.object({
  merchantName: z.string().nullable().optional(),
  currency: z.string().default("USD"),
  subtotalCents: z.number().int().nullable().optional(),
  taxCents: z.number().int().nullable().optional(),
  tipCents: z.number().int().nullable().optional(),
  totalCents: z.number().int().nullable().optional(),
  rawText: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().positive(),
      unitPriceCents: z.number().int(),
      totalPriceCents: z.number().int(),
      confidence: z.number().min(0).max(1)
    })
  )
});

export class OpenAiOcrProvider {
  private readonly client: OpenAI;

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  async parseReceiptFromImageUrl(imageUrl: string): Promise<ParsedReceipt> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        {
          role: "system",
          content:
            "Extract receipt line-items and totals. Return strict JSON matching schema. Prices must be in cents. Set currency to the ISO 4217 three-letter code implied by the receipt (symbols, text, or country context), e.g. USD, EUR, MVR. If the image is blank, too dark, too blurry, or has no readable receipt text, do not guess. In that case return merchantName=null, rawText='', items=[], subtotalCents=null, taxCents=null, tipCents=null, totalCents=null."
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Parse this receipt image into structured bill data."
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "auto"
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "parsed_receipt",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              merchantName: { type: ["string", "null"] },
              currency: { type: "string" },
              subtotalCents: { type: ["integer", "null"] },
              taxCents: { type: ["integer", "null"] },
              tipCents: { type: ["integer", "null"] },
              totalCents: { type: ["integer", "null"] },
              rawText: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    qty: { type: "number" },
                    unitPriceCents: { type: "integer" },
                    totalPriceCents: { type: "integer" },
                    confidence: { type: "number" }
                  },
                  required: [
                    "name",
                    "qty",
                    "unitPriceCents",
                    "totalPriceCents",
                    "confidence"
                  ]
                }
              }
            },
            required: [
              "merchantName",
              "currency",
              "subtotalCents",
              "taxCents",
              "tipCents",
              "totalCents",
              "rawText",
              "items"
            ]
          }
        }
      }
    });

    const rawText = response.output_text;
    if (!rawText?.trim()) {
      throw new Error("OpenAI returned empty OCR output");
    }
    const payload = JSON.parse(rawText);
    const parsed = parsedReceiptSchema.parse(payload);
    return {
      merchantName: parsed.merchantName ?? undefined,
      currency: normalizeCurrencyCode(parsed.currency),
      subtotalCents: parsed.subtotalCents ?? undefined,
      taxCents: parsed.taxCents ?? undefined,
      tipCents: parsed.tipCents ?? undefined,
      totalCents: parsed.totalCents ?? undefined,
      rawText: parsed.rawText,
      items: parsed.items
    };
  }
}
