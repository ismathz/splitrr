/**
 * In-memory ring of recent initData auth failures (no secrets / no raw initData).
 * Exposed via GET /api/auth/last-failures for temporary production diagnosis.
 */

export type AuthFailureAttempt = {
  source: string;
  reason: string;
  len: number;
  /** Whether the candidate string contained a `signature=` field (modern clients). */
  hasSignature: boolean;
  /** Whether the candidate string contained a `hash=` field. */
  hasHash: boolean;
};

export type AuthFailureRecord = {
  at: string;
  path: string;
  method: string;
  reason: string;
  botId: string | null;
  tokenSuffix: string | null;
  attempts: AuthFailureAttempt[];
};

const MAX = 20;
const recent: AuthFailureRecord[] = [];

export function recordAuthFailure(entry: Omit<AuthFailureRecord, "at">): void {
  recent.unshift({ ...entry, at: new Date().toISOString() });
  if (recent.length > MAX) recent.length = MAX;
}

export function listRecentAuthFailures(): AuthFailureRecord[] {
  return [...recent];
}

/** Safe structural flags for a candidate string (never log the string itself). */
export function initDataShapeFlags(value: string): {
  hasSignature: boolean;
  hasHash: boolean;
} {
  return {
    hasSignature: /(?:^|&)signature=/.test(value) || /(?:^|&)signature%3D/i.test(value),
    hasHash: /(?:^|&)hash=/.test(value) || /(?:^|&)hash%3D/i.test(value)
  };
}
