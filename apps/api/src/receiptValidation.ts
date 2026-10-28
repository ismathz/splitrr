const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

/** 10 MiB default max receipt upload. */
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function validateReceiptFile(file: File):
  | { ok: true; mime: string }
  | { ok: false; message: string } {
  const mime = (file.type || "").toLowerCase().trim() || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      message: "Unsupported file type. Upload a JPEG, PNG, WebP, or HEIC image."
    };
  }
  if (file.size <= 0) {
    return { ok: false, message: "Empty file." };
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return {
      ok: false,
      message: `File too large (max ${Math.floor(MAX_RECEIPT_BYTES / (1024 * 1024))} MB).`
    };
  }
  return { ok: true, mime: mime === "image/jpg" ? "image/jpeg" : mime };
}
