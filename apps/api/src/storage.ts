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
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
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
