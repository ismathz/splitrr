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

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif"
};

/** Telegram WebViews often send empty `File.type` for camera captures. */
export function sniffReceiptMime(file: File): string {
  const declared = (file.type || "").toLowerCase().trim();
  if (declared && declared !== "application/octet-stream") {
    return declared === "image/jpg" ? "image/jpeg" : declared;
  }
  const name = file.name || "";
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (ext && EXT_MIME[ext]) return EXT_MIME[ext];
  // Default camera captures from Telegram are usually JPEG.
  return "image/jpeg";
}

export function validateReceiptFile(file: File):
  | { ok: true; mime: string }
  | { ok: false; message: string } {
  const mime = sniffReceiptMime(file);
  if (!ALLOWED_MIME.has(mime) && !ALLOWED_MIME.has(mime.replace("image/jpg", "image/jpeg"))) {
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
