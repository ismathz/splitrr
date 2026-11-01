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
    name?: string;
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
  // OpenAI uses HTTP 429 for both true rate limits AND billing/quota exhaustion.
  // credit_balance_exhausted / insufficient_quota are NOT fixed by waiting a minute.
  if (
    /credit_balance_exhausted|insufficient_quota|billing_not_active|billing_hard_limit/i.test(
      `${openaiCode} ${raw}`
    )
  ) {
    return {
      code: "openai_quota_exhausted",
      message:
        "OpenAI account has no usable credit/quota for OCR. Add billing/credits for the OPENAI_API_KEY on the API host, then retry.",
      status: 502,
      openaiStatus,
      openaiCode
    };
  }
  if (
    openaiStatus === 429 ||
    /rate_limit|too_many_requests/i.test(`${openaiCode} ${raw}`)
  ) {
    return {
      code: "openai_rate_limited",
      message: "OpenAI is temporarily rate-limiting scans. Wait a minute and try again.",
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
  if (
    /invalid_image|image_url|timeout while downloading|download|fetch.*image|unsupported.*image/i.test(
      `${openaiCode} ${raw}`
    )
  ) {
    return {
      code: "openai_image_unreadable",
      message:
        "OpenAI could not read the receipt image. Re-upload as JPEG/PNG (not HEIC), or try again.",
      status: 422,
      openaiStatus,
      openaiCode
    };
  }
  if (/openai_empty_output|openai_bad_json/i.test(`${openaiCode} ${raw}`)) {
    return {
      code: "openai_bad_output",
      message: "OpenAI returned an unusable OCR result. Try a clearer photo.",
      status: 502,
      openaiStatus,
      openaiCode
    };
  }
  if (/ZodError|invalid_type|too_small/i.test(`${anyErr?.name ?? ""} ${raw}`)) {
    return {
      code: "ocr_schema_mismatch",
      message: "OCR result did not match the expected format. Try again or add items manually.",
      status: 502,
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
