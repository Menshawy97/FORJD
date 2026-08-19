import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { StorageObjectRef, StorageProvider, UploadRequest } from './storage-provider.interface';

/**
 * The second and last file permitted to import the Supabase SDK (ADR-008).
 *
 * Nothing calls this in Phase 1 — InBody upload in Phase 5 is its first consumer. It is
 * written now, while the adapter pattern is fresh, rather than under Phase 5 deadline
 * pressure. Addressing is bucket/key so swapping in S3 or R2 replaces this file alone.
 */
@Injectable()
export class SupabaseStorageProvider implements StorageProvider {
  private readonly client: SupabaseClient;

  constructor(config: ConfigService) {
    this.client = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }

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

  async delete(ref: StorageObjectRef): Promise<void> {
    const { error } = await this.client.storage.from(ref.bucket).remove([ref.key]);

    if (error) {
      throw new InternalServerErrorException(`Delete failed: ${error.message}`);
    }
  }
}
