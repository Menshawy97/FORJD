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

export interface StorageProvider {
  upload(request: UploadRequest): Promise<StorageObjectRef>;
  getSignedUrl(ref: StorageObjectRef, expiresInSeconds: number): Promise<string>;
  delete(ref: StorageObjectRef): Promise<void>;
}
