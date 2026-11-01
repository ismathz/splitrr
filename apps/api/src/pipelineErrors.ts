/**
 * In-memory ring of recent receipt upload/OCR failures (no secrets / no image bytes).
 */

export type PipelineFailureRecord = {
  at: string;
  stage: "upload" | "ocr" | "create_bill";
  path: string;
  code: string;
  message: string;
  httpStatus?: number;
  openaiStatus?: number;
  openaiCode?: string;
  mime?: string;
  sizeBytes?: number;
};

const MAX = 20;
const recent: PipelineFailureRecord[] = [];

export function recordPipelineFailure(
  entry: Omit<PipelineFailureRecord, "at">
): void {
  recent.unshift({ ...entry, at: new Date().toISOString() });
  if (recent.length > MAX) recent.length = MAX;
}

export function listRecentPipelineFailures(): PipelineFailureRecord[] {
  return [...recent];
}

export function classifyOpenAiError(err: unknown): {
  code: string;
  message: string;
  status: number;
  openaiStatus?: number;
  openaiCode?: string;
} {
  const anyErr = err as {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    error?: { code?: string; type?: string; message?: string };
  };
  const openaiStatus = anyErr?.status;
  const openaiCode = anyErr?.code || anyErr?.error?.code || anyErr?.type;
  const raw = anyErr?.error?.message || anyErr?.message || "";

  if (openaiStatus === 401 || /invalid_api_key|authentication/i.test(`${openaiCode} ${raw}`)) {
    return {
      code: "openai_auth_failed",
      message:
        "OpenAI rejected the API key. Set a valid OPENAI_API_KEY on the API host and restart splitbot-api.",
      status: 502,
      openaiStatus,
      openaiCode
    };
  }
  if (openaiStatus === 429 || /rate_limit/i.test(`${openaiCode} ${raw}`)) {
    return {
      code: "openai_rate_limited",
      message: "Receipt scanning is temporarily rate-limited. Try again in a minute.",
      status: 429,
      openaiStatus,
      openaiCode
    };
  }
  if (/model|not.?found|does not exist/i.test(`${openaiCode} ${raw}`)) {
    return {
      code: "openai_model_invalid",
      message:
        "OpenAI model is invalid. Check OPENAI_MODEL on the API host (e.g. gpt-4.1-mini).",
      status: 502,
      openaiStatus,
      openaiCode
    };
  }
  if (/invalid_image|image_url|download|fetch.*image|unsupported.*image/i.test(raw)) {
    return {
      code: "openai_image_unreadable",
      message:
        "OpenAI could not read the receipt image. Try JPEG/PNG, or check that R2 signed URLs are reachable.",
      status: 422,
      openaiStatus,
      openaiCode
    };
  }
  return {
    code: "ocr_failed",
    message: "OCR failed. Try a clearer photo or add items manually.",
    status: 502,
    openaiStatus,
    openaiCode
  };
}
