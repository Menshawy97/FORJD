import { Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

import {
  EnsureBucketOptions,
  StorageObjectRef,
  StorageProvider,
  UploadRequest,
} from './storage-provider.interface';
import { SUPABASE_STORAGE_CLIENT } from './supabase-storage-client';

/**
 * The second and last file permitted to import the Supabase SDK (ADR-008).
 *
 * The exercise-media mirror (Phase F) is its first real consumer — InBody upload (Phase 5)
 * was the one originally anticipated when this was written under Phase 1. The client is
 * injected via `SUPABASE_STORAGE_CLIENT` rather than built here, the same fix applied to
 * `SupabaseAuthProvider` for the same reason (ADR-011): a provider that constructs its own
 * client is verifiable only by hand against a live project. Addressing is bucket/key so
 * swapping in S3 or R2 replaces this file alone.
 */
@Injectable()
export class SupabaseStorageProvider implements StorageProvider {
  constructor(@Inject(SUPABASE_STORAGE_CLIENT) private readonly client: SupabaseClient) {}

  async upload(request: UploadRequest): Promise<StorageObjectRef> {
    const { error } = await this.client.storage
      .from(request.bucket)
      .upload(request.key, request.body, { contentType: request.contentType, upsert: false });

    if (error) {
      throw new InternalServerErrorException(`Upload failed: ${error.message}`);
    }

    return { bucket: request.bucket, key: request.key };
  }

  async getSignedUrl(ref: StorageObjectRef, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(ref.bucket)
      .createSignedUrl(ref.key, expiresInSeconds);

    if (error || !data) {
      throw new NotFoundException(`No such object: ${ref.key}`);
    }

    return data.signedUrl;
  }

  getPublicUrl(ref: StorageObjectRef): string {
    const {
      data: { publicUrl },
    } = this.client.storage.from(ref.bucket).getPublicUrl(ref.key);

    return publicUrl;
  }

  async delete(ref: StorageObjectRef): Promise<void> {
    const { error } = await this.client.storage.from(ref.bucket).remove([ref.key]);

    if (error) {
      throw new InternalServerErrorException(`Delete failed: ${error.message}`);
    }
  }

  /**
   * Supabase Storage has no direct "does this object exist" call. `list()` against the
   * object's parent folder, filtered to its exact filename, is the documented way to ask —
   * cheaper than `download()`-ing the object just to find out, and it needs no signed URL.
   */
  async exists(ref: StorageObjectRef): Promise<boolean> {
    const separatorIndex = ref.key.lastIndexOf('/');
    const folder = separatorIndex === -1 ? '' : ref.key.slice(0, separatorIndex);
    const filename = separatorIndex === -1 ? ref.key : ref.key.slice(separatorIndex + 1);

    const { data, error } = await this.client.storage
      .from(ref.bucket)
      .list(folder, { search: filename, limit: 1 });

    if (error) {
      throw new InternalServerErrorException(`List failed: ${error.message}`);
    }

    return (data ?? []).some((entry) => entry.name === filename);
  }

  /**
   * Idempotent: `createBucket` errors if the bucket is already there, and that specific
   * failure is the expected steady state on every deploy after the first, so it is treated
   * as success rather than surfaced. Any other error (bad credentials, no storage
   * entitlement) still throws.
   */
  async ensureBucket(bucket: string, options: EnsureBucketOptions): Promise<void> {
    const { error } = await this.client.storage.createBucket(bucket, { public: options.public });

    if (error && !/already exists/i.test(error.message)) {
      throw new InternalServerErrorException(`Bucket setup failed: ${error.message}`);
    }
  }
}
