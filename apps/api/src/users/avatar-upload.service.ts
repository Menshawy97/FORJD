import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AvatarUploadResponse } from '@forjd/contracts';
import { User } from '@forjd/domain';
import { randomUUID } from 'node:crypto';

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

/** Keeps the stored object's extension meaningful without trusting the client's filename. */
const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 5 MiB. Generous for a profile photo, small enough that one upload cannot become a DoS vector. */
/** Exported so `users.controller.ts` can pass the same limit to `FileInterceptor`, rejecting
 * an oversized part before multer fully buffers it -- this constant staying the source of
 * truth for the check below too, rather than two numbers that could drift apart. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

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

    const extension = ALLOWED_AVATAR_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG or WebP.');
    }

    // A fresh random key per upload, not a fixed `${userId}.${extension}` -- `upload` is
    // called with `upsert: false` (see SupabaseStorageProvider), so overwriting a previous
    // avatar at a stable key would be a conflict, not a replace. The old object is simply
    // orphaned; a cleanup job for stale avatar objects is future work, not this slice's.
    const ref = { bucket: AVATAR_BUCKET, key: `${user.id}/${randomUUID()}.${extension}` };

    await this.storageProvider.upload({
      ...ref,
      body: file.buffer,
      contentType: file.mimetype,
    });

    const avatarUrl = this.storageProvider.getPublicUrl(ref);

    const updated = await this.usersRepository.updateProfile(user.id, { avatarUrl });
    if (!updated) {
      throw new NotFoundException('Profile not found');
    }

    return { avatarUrl };
  }
}
