import {
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Object storage for invoices, logos, and measurement photos (TRD §5.3).
 * MinIO in dev, S3 in production — same API, different endpoint.
 * Objects are private; access is granted via short-lived presigned URLs.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;
  private bucket = 'tailonix-dev';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY');
    if (!accessKeyId || !secretAccessKey) {
      this.logger.warn('S3 credentials not set — file storage is disabled');
      return;
    }
    this.bucket = this.config.get<string>('S3_BUCKET', this.bucket);
    const endpoint = this.config.get<string>('S3_ENDPOINT');

    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION', 'me-south-1'),
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}), // MinIO needs path-style
    });
    await this.ensureBucket();
  }

  isEnabled(): boolean {
    return this.client !== undefined;
  }

  private async ensureBucket(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      } catch (err) {
        this.logger.error(`Cannot access or create bucket: ${(err as Error).message}`);
        this.client = undefined;
      }
    }
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.client) throw new Error('Storage is not configured');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return key;
  }

  /** Reads an object back — used by the ZATCA integrity re-hash. */
  async getObject(key: string): Promise<Buffer> {
    if (!this.client) throw new Error('Storage is not configured');
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /** Temporary download link — default 1 hour (TRD §5.3). */
  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.client) throw new Error('Storage is not configured');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
