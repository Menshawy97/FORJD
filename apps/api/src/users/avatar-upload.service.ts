import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AvatarUploadResponse } from '@forjd/contracts';
import { User } from '@forjd/domain';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { STORAGE_PROVIDER, StorageProvider } from '../storage/providers/storage-provider.interface';
import { UsersRepository } from './users.repository';

/**
 * `StorageModule`'s first request-serving consumer (ADR-019) -- the exercise-media mirror
 * (Phase F) was the first consumer overall, but that runs as an offline script, not inside a
 * request. Public, not signed (ADR-019): an avatar is rendered constantly across the app
 * (profile, athlete cards, leaderboards from Phase 10 onward), and a signed URL would need
 * re-issuing on every one of those reads or would expire mid-session, for an asset that is not
 * sensitive in the way an InBody scan photo is.
 */
export const AVATAR_BUCKET = 'avatars';

/**
 * Deliberately not `Express.Multer.File` -- that type ships with `multer`'s own `.d.ts`, which
 * this project's pinned `multer` version does not publish, so importing it would need a new
 * `@types/multer` dependency for a shape this file only reads three fields from. `@UploadedFile`
 * does not care what type it is asked for; this is the minimal shape `FileInterceptor`
 * (memory storage, the Nest default) actually attaches to the request.
 */
export interface UploadedAvatarFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * ADR-024: an input-validation gate only -- "is this actually an image we accept" -- decoupled
 * from what gets stored. Before ADR-024 this map doubled as the *stored* extension for each
 * input MIME type; now every accepted upload is unconditionally re-encoded to WebP server-side
 * (see `upload` below), so there is no longer a per-input-type extension to track.
 */
const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 5 MiB. Generous for a profile photo, small enough that one upload cannot become a DoS vector. */
/** Exported so `users.controller.ts` can pass the same limit to `FileInterceptor`, rejecting
 * an oversized part before multer fully buffers it -- this constant staying the source of
 * truth for the check below too, rather than two numbers that could drift apart. Gates the
 * *input* size before decoding; independent of, and still needed alongside, the ADR-024
 * compression step below. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** ADR-024's avatar row: 512x512 max dimension, WebP quality 80. */
const AVATAR_MAX_DIMENSION = 512;
const AVATAR_WEBP_QUALITY = 80;

@Injectable()
export class AvatarUploadService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
    private readonly usersRepository: UsersRepository,
  ) {}

  async upload(user: User, file: UploadedAvatarFile | undefined): Promise<AvatarUploadResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Image must be 5 MB or smaller');
    }

    if (!ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG or WebP.');
    }

    // ADR-024: server-side canonical re-encode. The server never trusts client-side
    // compression -- a stale app build, a buggy client, or a hand-crafted request could skip
    // it entirely -- so every accepted upload is unconditionally resized and re-encoded here,
    // regardless of what the client actually sent. `sharp` throws on a corrupt or non-image
    // buffer (bytes that passed the MIME-type check above but are not actually decodable);
    // that becomes the same `BadRequestException` pattern as every other validation failure in
    // this method, never an unhandled 500.
    let webpBuffer: Buffer;
    try {
      webpBuffer = await sharp(file.buffer)
        .resize(AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: AVATAR_WEBP_QUALITY })
        .toBuffer();
    } catch {
      throw new BadRequestException('Could not process image. The file may be corrupt.');
    }

    // A fresh random key per upload, not a fixed `${userId}.${extension}` -- `upload` is
    // called with `upsert: false` (see SupabaseStorageProvider), so overwriting a previous
    // avatar at a stable key would be a conflict, not a replace. The old object is simply
    // orphaned; a cleanup job for stale avatar objects is future work, not this slice's.
    //
    // Always `.webp`: the stored object's extension reflects the server's own re-encoded
    // output (ADR-024), never whatever format the client originally sent.
    const ref = { bucket: AVATAR_BUCKET, key: `${user.id}/${randomUUID()}.webp` };

    await this.storageProvider.upload({
      ...ref,
      body: webpBuffer,
      contentType: 'image/webp',
    });

    const avatarUrl = this.storageProvider.getPublicUrl(ref);

    const updated = await this.usersRepository.updateProfile(user.id, { avatarUrl });
    if (!updated) {
      throw new NotFoundException('Profile not found');
    }

    return { avatarUrl };
  }
}
