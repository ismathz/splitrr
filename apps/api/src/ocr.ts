import OpenAI from "openai";
import { z } from "zod";
import type { ParsedReceipt } from "@splitbot/shared";
import { normalizeCurrencyCode } from "@splitbot/shared";

const parsedReceiptSchema = z.object({
  merchantName: z.string().nullable().optional(),
  currency: z.string().default("USD"),
  subtotalCents: z.number().int().nullable().optional(),
  serviceChargeCents: z.number().int().nullable().optional(),
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

const OCR_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif"
]);

const RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    merchantName: { type: ["string", "null"] },
    currency: { type: "string" },
    subtotalCents: { type: ["integer", "null"] },
    serviceChargeCents: { type: ["integer", "null"] },
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
    "serviceChargeCents",
    "taxCents",
    "tipCents",
    "totalCents",
    "rawText",
    "items"
  ]
} as const;

const SYSTEM_PROMPT =
  "Extract receipt line-items and totals. Return strict JSON matching schema. Prices must be in cents. Set currency to the ISO 4217 three-letter code implied by the receipt (symbols, text, or country context), e.g. USD, EUR, MVR. Put food/drink goods in items only — do not invent line items. Set serviceChargeCents only when a service charge/fee appears on the receipt (else null). Set taxCents only when tax/GST/VAT appears (else null). Set tipCents only when a tip/gratuity appears separately from service charge (else null). Include discounts as negative totalPriceCents line items when printed on the bill; never invent discounts, service charge, or tax. If the image is blank, too dark, too blurry, or has no readable receipt text, do not guess. In that case return merchantName=null, rawText='', items=[], subtotalCents=null, serviceChargeCents=null, taxCents=null, tipCents=null, totalCents=null.";

/** Build a base64 data URL for vision OCR (OpenRouter cannot fetch private R2 URLs). */
export function toOcrImageDataUrl(
  bytes: Uint8Array,
  contentType: string
): { ok: true; dataUrl: string; mime: string } | { ok: false; message: string } {
  let mime = (contentType || "").toLowerCase().trim() || "application/octet-stream";
  if (mime === "image/jpg") mime = "image/jpeg";
  if (mime === "application/octet-stream") mime = "image/jpeg";
  if (mime === "image/heic" || mime === "image/heif") {
    return {
      ok: false,
      message:
        "HEIC/HEIF receipts are not supported for scanning. Please re-take or export the photo as JPEG or PNG."
    };
  }
  if (!OCR_IMAGE_MIMES.has(mime)) {
    return {
      ok: false,
      message: `Unsupported image type for OCR (${mime}). Upload a JPEG, PNG, or WebP.`
    };
  }
  const b64 = Buffer.from(bytes).toString("base64");
  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, mime };
}

/** @deprecated Use toOcrImageDataUrl */
export const toOpenAiImageDataUrl = toOcrImageDataUrl;

export class OpenRouterOcrProvider {
  private readonly client: OpenAI;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    baseUrl: string,
    opts?: { referer?: string; title?: string }
  ) {
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: baseUrl.replace(/\/$/, ""),
      defaultHeaders: {
        ...(opts?.referer ? { "HTTP-Referer": opts.referer } : {}),
        ...(opts?.title ? { "X-Title": opts.title } : {})
      }
    });
  }

  /**
   * Prefer a data URL (base64). OpenRouter/upstream often fails to fetch private
   * R2/S3 signed URLs (`Timeout while downloading` / `invalid_image_url`).
   */
  async parseReceiptFromImageUrl(imageUrl: string): Promise<ParsedReceipt> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Parse this receipt image into structured bill data."
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_receipt",
          strict: true,
          schema: RECEIPT_JSON_SCHEMA
        }
      }
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText?.trim()) {
      throw Object.assign(new Error("OpenRouter returned empty OCR output"), {
        code: "openrouter_empty_output"
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw Object.assign(new Error("OpenRouter returned non-JSON OCR output"), {
        code: "openrouter_bad_json"
      });
    }
    const parsed = parsedReceiptSchema.parse(payload);
    return {
      merchantName: parsed.merchantName ?? undefined,
      currency: normalizeCurrencyCode(parsed.currency),
      subtotalCents: parsed.subtotalCents ?? undefined,
      serviceChargeCents: parsed.serviceChargeCents ?? undefined,
      taxCents: parsed.taxCents ?? undefined,
      tipCents: parsed.tipCents ?? undefined,
      totalCents: parsed.totalCents ?? undefined,
      rawText: parsed.rawText,
      items: parsed.items
    };
  }
}
