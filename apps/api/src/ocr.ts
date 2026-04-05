import OpenAI from "openai";
import { z } from "zod";
import type { ParsedReceipt } from "@splitbot/shared";

const parsedReceiptSchema = z.object({
  merchantName: z.string().optional(),
  currency: z.string().default("USD"),
  subtotalCents: z.number().int().optional(),
  taxCents: z.number().int().optional(),
  tipCents: z.number().int().optional(),
  totalCents: z.number().int().optional(),
  rawText: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().positive(),
      unitPriceCents: z.number().int().nonnegative(),
      totalPriceCents: z.number().int().nonnegative(),
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
            "Extract receipt line-items and totals. Return strict JSON matching schema. Prices must be in cents."
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
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              merchantName: { type: "string" },
              currency: { type: "string" },
              subtotalCents: { type: "integer" },
              taxCents: { type: "integer" },
              tipCents: { type: "integer" },
              totalCents: { type: "integer" },
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
            required: ["currency", "rawText", "items"]
          }
        }
      }
    });

    const payload = JSON.parse(response.output_text);
    return parsedReceiptSchema.parse(payload);
  }
}
