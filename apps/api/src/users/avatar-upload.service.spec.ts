import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Profile, User } from '@forjd/domain';
import sharp from 'sharp';

import { StorageProvider } from '../storage/providers/storage-provider.interface';
import { AvatarUploadService, AVATAR_BUCKET } from './avatar-upload.service';
import { UsersRepository } from './users.repository';

/**
 * A unit test -- `StorageProvider` is mocked rather than hitting real Supabase Storage, same
 * reasoning as `UsersService`'s tests: the decision under test (validate, key, upload, write
 * the URL back) is entirely in this file.
 *
 * `sharp` itself is exercised for real (not mocked) for the ADR-024 compression tests below --
 * the whole point is verifying real compression happens, so the fixtures are real decodable
 * images generated with `sharp`'s own `create` API rather than fake byte strings.
 */
describe('AvatarUploadService', () => {
  const user: User = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ada@example.com',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const profile = { userId: user.id } as Profile;

  let storageProvider: {
    upload: jest.Mock;
    getPublicUrl: jest.Mock;
    ensureBucket: jest.Mock;
  };
  let usersRepository: { updateProfile: jest.Mock };
  let service: AvatarUploadService;

  let jpegFile: { buffer: Buffer; mimetype: string; size: number };

  beforeAll(async () => {
    // A real, small, decodable JPEG -- not the placeholder byte string this file used before
    // ADR-024, which `sharp` would now (correctly) reject as undecodable.
    const buffer = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    jpegFile = { buffer, mimetype: 'image/jpeg', size: buffer.length };
  });

  beforeEach(() => {
    storageProvider = {
      upload: jest.fn().mockResolvedValue({ bucket: AVATAR_BUCKET, key: 'some-key' }),
      getPublicUrl: jest.fn().mockReturnValue('https://storage.example.com/avatars/some-key.webp'),
      ensureBucket: jest.fn().mockResolvedValue(undefined),
    };
    usersRepository = { updateProfile: jest.fn().mockResolvedValue(profile) };
    service = new AvatarUploadService(
      storageProvider as unknown as StorageProvider,
      usersRepository as unknown as UsersRepository,
    );
  });

  it('rejects when no file is uploaded', async () => {
    await expect(service.upload(user, undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(storageProvider.upload).not.toHaveBeenCalled();
  });

  it('rejects a file over 5 MB', async () => {
    const tooBig = { ...jpegFile, size: 5 * 1024 * 1024 + 1 };

    await expect(service.upload(user, tooBig)).rejects.toBeInstanceOf(BadRequestException);
    expect(storageProvider.upload).not.toHaveBeenCalled();
  });

  it('rejects an unsupported image type', async () => {
    const gif = { ...jpegFile, mimetype: 'image/gif' };

    await expect(service.upload(user, gif)).rejects.toBeInstanceOf(BadRequestException);
    expect(storageProvider.upload).not.toHaveBeenCalled();
  });

  it('uploads to the avatars bucket under the user id, keyed as WebP', async () => {
    await service.upload(user, jpegFile);

    expect(storageProvider.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: AVATAR_BUCKET,
        key: expect.stringMatching(new RegExp(`^${user.id}/.+\\.webp$`)),
        contentType: 'image/webp',
      }),
    );
  });

  it('writes the public URL back onto the profile via the repository', async () => {
    await service.upload(user, jpegFile);

    expect(usersRepository.updateProfile).toHaveBeenCalledWith(user.id, {
      avatarUrl: 'https://storage.example.com/avatars/some-key.webp',
    });
  });

  it('returns the new avatar URL', async () => {
    await expect(service.upload(user, jpegFile)).resolves.toEqual({
      avatarUrl: 'https://storage.example.com/avatars/some-key.webp',
    });
  });

  it('throws NotFound when the profile row does not exist', async () => {
    usersRepository.updateProfile.mockResolvedValue(null);

    await expect(service.upload(user, jpegFile)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ADR-024: server-side canonical re-encode. The server never trusts client-side compression
  // -- every accepted upload is unconditionally resized and re-encoded here.
  describe('image compression (ADR-024)', () => {
    it('resizes an oversized image to fit within 512x512 and re-encodes it to WebP', async () => {
      const oversized = await sharp({
        create: { width: 2000, height: 1500, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .jpeg()
        .toBuffer();
      const file = { buffer: oversized, mimetype: 'image/jpeg', size: oversized.length };

      await service.upload(user, file);

      const uploadedBody = storageProvider.upload.mock.calls[0][0].body as Buffer;
      const metadata = await sharp(uploadedBody).metadata();

      expect(metadata.format).toBe('webp');
      // 2000x1500 is 4:3 -- the wider side (width) hits the 512 cap, aspect ratio preserved.
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(384);
    });

    it('does not upscale an image already smaller than the 512px cap', async () => {
      const small = await sharp({
        create: { width: 100, height: 80, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
        .png()
        .toBuffer();
      const file = { buffer: small, mimetype: 'image/png', size: small.length };

      await service.upload(user, file);

      const uploadedBody = storageProvider.upload.mock.calls[0][0].body as Buffer;
      const metadata = await sharp(uploadedBody).metadata();

      expect(metadata.width).toBe(100);
      expect(metadata.height).toBe(80);
    });

    it('rejects a corrupt or non-image buffer with BadRequestException, not an unhandled 500', async () => {
      const corrupt = {
        buffer: Buffer.from('not actually an image, just some bytes'),
        mimetype: 'image/jpeg',
        size: 40,
      };

      await expect(service.upload(user, corrupt)).rejects.toBeInstanceOf(BadRequestException);
      expect(storageProvider.upload).not.toHaveBeenCalled();
    });

    it('stores every upload as WebP, keyed with a .webp extension, regardless of input format', async () => {
      const png = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
        .png()
        .toBuffer();
      const file = { buffer: png, mimetype: 'image/png', size: png.length };

      await service.upload(user, file);

      expect(storageProvider.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(new RegExp(`^${user.id}/.+\\.webp$`)),
          contentType: 'image/webp',
        }),
      );
      const uploadedBody = storageProvider.upload.mock.calls[0][0].body as Buffer;
      const metadata = await sharp(uploadedBody).metadata();
      expect(metadata.format).toBe('webp');
    });
  });
});
