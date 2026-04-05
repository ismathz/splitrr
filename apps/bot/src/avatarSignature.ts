import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC for signed avatar proxy URLs (no bot token in the client).
 */
export function signAvatarRequest(
  userId: number,
  chatId: string,
  expSec: number,
  secret: string,
): string {
  const payload = `${userId}|${chatId}|${expSec}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyAvatarRequest(
  userId: number,
  chatId: string,
  expSec: number,
  sig: string,
  secret: string,
): boolean {
  if (!Number.isFinite(expSec) || Date.now() / 1000 > expSec) return false;
  const expected = signAvatarRequest(userId, chatId, expSec, secret);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
