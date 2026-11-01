import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface StoredObjectMeta {
  key: string;
  contentType: string;
  sizeBytes: number;
}

interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
}

export class StorageService {
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly client: S3Client;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.keyPrefix = config.keyPrefix.replace(/^\/+|\/+$/g, "");
    // R2 (and some other S3-compat stores) reject AWS SDK v3.729+ default
    // flexible checksums on PutObject → InternalError. Cloudflare docs:
    // requestChecksumCalculation / responseChecksumValidation = WHEN_REQUIRED.
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED"
    });
  }

  async putObject(
    key: string,
    body: Uint8Array,
    contentType: string
  ): Promise<StoredObjectMeta> {
    const objectKey = this.withPrefix(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType
      })
    );

    return {
      key: objectKey,
      contentType,
      sizeBytes: body.byteLength
    };
  }

  async getSignedUrl(key: string, expiresSec = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      }),
      { expiresIn: expiresSec }
    );
  }

  /** Fetch object bytes from R2/S3 (for OCR base64 — OpenRouter often cannot fetch R2 signed URLs). */
  async getObjectBytes(key: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
  }> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    );
    const body = res.Body;
    if (!body) {
      throw new Error("storage_empty_object");
    }
    const bytes = new Uint8Array(await body.transformToByteArray());
    const contentType =
      (res.ContentType || "application/octet-stream").toLowerCase().trim() ||
      "application/octet-stream";
    return { bytes, contentType };
  }

  /** True when `key` is under this service's configured prefix (rejects arbitrary URLs/keys). */
  isOwnedKey(key: string): boolean {
    const normalized = key.replace(/^\/+/, "");
    if (!this.keyPrefix) return normalized.length > 0 && !normalized.includes("..");
    return (
      normalized.startsWith(`${this.keyPrefix}/`) && !normalized.includes("..")
    );
  }

  async assertBucketAccess(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  private withPrefix(key: string): string {
    if (!this.keyPrefix) {
      return key;
    }
    return `${this.keyPrefix}/${key.replace(/^\/+/, "")}`;
  }
}

/** Classify S3/R2 errors for API responses (never include credentials). */
export function classifyStorageError(err: unknown): {
  code: string;
  message: string;
  status: number;
} {
  const anyErr = err as {
    name?: string;
    Code?: string;
    code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code =
    anyErr?.Code ||
    anyErr?.code ||
    anyErr?.name ||
    "storage_error";
  const http = anyErr?.$metadata?.httpStatusCode;
  const raw = typeof anyErr?.message === "string" ? anyErr.message : "";

  if (/checksum|x-amz-checksum|NotImplemented/i.test(`${code} ${raw}`)) {
    return {
      code: "storage_checksum_rejected",
      message:
        "Receipt storage rejected the upload (S3 checksum). Check R2/S3 client config.",
      status: 502
    };
  }
  if (/NoSuchBucket|NotFound|404/i.test(`${code} ${raw}`) || http === 404) {
    return {
      code: "storage_bucket_missing",
      message: "Receipt storage bucket was not found. Check S3_BUCKET on the API host.",
      status: 502
    };
  }
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied|403/i.test(`${code} ${raw}`) || http === 403) {
    return {
      code: "storage_auth_failed",
      message:
        "Receipt storage credentials were rejected. Check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.",
      status: 502
    };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|networking/i.test(`${code} ${raw}`)) {
    return {
      code: "storage_unreachable",
      message: "Could not reach receipt storage (S3_ENDPOINT). Check network / endpoint URL.",
      status: 502
    };
  }
  return {
    code: "storage_error",
    message: "Could not store the receipt image. Try again in a moment.",
    status: 502
  };
}
