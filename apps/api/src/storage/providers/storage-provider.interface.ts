// Bucket/key addressing is deliberately S3-shaped: Supabase Storage is S3-compatible, so
// swapping in S3 or R2 later is a new implementation of this interface and nothing else.
export interface StorageObjectRef {
  bucket: string;
  key: string;
}

export interface UploadRequest extends StorageObjectRef {
  body: Buffer;
  contentType: string;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface EnsureBucketOptions {
  public: boolean;
}

export interface StorageProvider {
  upload(request: UploadRequest): Promise<StorageObjectRef>;
  /**
   * Added for the exercise-media mirror (ADR-018): a bulk, idempotent copy has to tell
   * "already mirrored" from "needs uploading" for each of ~1,746 keys without treating
   * `upload`'s own conflict error as the signal, which would make every re-run's steady
   * state a caught exception on the hot path.
   */
  exists(ref: StorageObjectRef): Promise<boolean>;
  getSignedUrl(ref: StorageObjectRef, expiresInSeconds: number): Promise<string>;
  delete(ref: StorageObjectRef): Promise<void>;
  /**
   * Idempotent bucket setup for scripts that own their bucket (the media mirror creates
   * `exercise-media` on first run). Not exposed to request-serving code -- nothing in the
   * request path should be creating buckets.
   */
  ensureBucket(bucket: string, options: EnsureBucketOptions): Promise<void>;
}
