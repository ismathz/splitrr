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
  openrouterStatus?: number;
  openrouterCode?: string;
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

export function classifyOpenRouterError(err: unknown): {
  code: string;
  message: string;
  status: number;
  openrouterStatus?: number;
  openrouterCode?: string;
} {
  const anyErr = err as {
    name?: string;
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    error?: { code?: string; type?: string; message?: string };
  };
  const openrouterStatus = anyErr?.status;
  const openrouterCode = anyErr?.code || anyErr?.error?.code || anyErr?.type;
  const raw = anyErr?.error?.message || anyErr?.message || "";
  const blob = `${openrouterCode} ${raw}`;

  if (
    openrouterStatus === 401 ||
    openrouterStatus === 403 ||
    /invalid_api_key|authentication|unauthorized|user not found|no auth credentials/i.test(
      blob
    )
  ) {
    return {
      code: "openrouter_auth_failed",
      message:
        "OpenRouter rejected the API key. Set a valid OPENROUTER_API_KEY on the API host and restart splitbot-api.",
      status: 502,
      openrouterStatus,
      openrouterCode
    };
  }
  // OpenRouter/providers use 402/429 (and various codes) for billing vs rate limits.
  if (
    openrouterStatus === 402 ||
    /credit_balance_exhausted|insufficient_quota|insufficient_credits|billing_not_active|billing_hard_limit|payment.?required|key limit exceeded|usage limit/i.test(
      blob
    )
  ) {
    return {
      code: "openrouter_quota_exhausted",
      message:
        "OpenRouter account has no usable credit/quota for OCR. Add credits at openrouter.ai for the OPENROUTER_API_KEY on the API host, then retry.",
      status: 502,
      openrouterStatus,
      openrouterCode
    };
  }
  if (
    openrouterStatus === 429 ||
    /rate_limit|too_many_requests|temporarily rate-limited/i.test(blob)
  ) {
    return {
      code: "openrouter_rate_limited",
      message:
        "OpenRouter is temporarily rate-limiting scans. Wait a minute and try again.",
      status: 429,
      openrouterStatus,
      openrouterCode
    };
  }
  if (/model|not.?found|does not exist|no endpoints found/i.test(blob)) {
    return {
      code: "openrouter_model_invalid",
      message:
        "OpenRouter model is invalid or unavailable. Check OPENROUTER_MODEL on the API host (e.g. openai/gpt-4o-mini).",
      status: 502,
      openrouterStatus,
      openrouterCode
    };
  }
  if (
    /invalid_image|image_url|timeout while downloading|download|fetch.*image|unsupported.*image/i.test(
      blob
    )
  ) {
    return {
      code: "openrouter_image_unreadable",
      message:
        "OpenRouter could not read the receipt image. Re-upload as JPEG/PNG (not HEIC), or try again.",
      status: 422,
      openrouterStatus,
      openrouterCode
    };
  }
  if (/openrouter_empty_output|openrouter_bad_json/i.test(blob)) {
    return {
      code: "openrouter_bad_output",
      message: "OpenRouter returned an unusable OCR result. Try a clearer photo.",
      status: 502,
      openrouterStatus,
      openrouterCode
    };
  }
  if (/ZodError|invalid_type|too_small/i.test(`${anyErr?.name ?? ""} ${raw}`)) {
    return {
      code: "ocr_schema_mismatch",
      message: "OCR result did not match the expected format. Try again or add items manually.",
      status: 502,
      openrouterStatus,
      openrouterCode
    };
  }
  return {
    code: "ocr_failed",
    message: "OCR failed. Try a clearer photo or add items manually.",
    status: 502,
    openrouterStatus,
    openrouterCode
  };
}
