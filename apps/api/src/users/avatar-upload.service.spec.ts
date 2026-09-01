import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Profile, User } from '@forjd/domain';

import { StorageProvider } from '../storage/providers/storage-provider.interface';
import { AvatarUploadService, AVATAR_BUCKET } from './avatar-upload.service';
import { UsersRepository } from './users.repository';

/**
 * A unit test -- `StorageProvider` is mocked rather than hitting real Supabase Storage, same
 * reasoning as `UsersService`'s tests: the decision under test (validate, key, upload, write
 * the URL back) is entirely in this file.
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

  beforeEach(() => {
    storageProvider = {
      upload: jest.fn().mockResolvedValue({ bucket: AVATAR_BUCKET, key: 'some-key' }),
      getPublicUrl: jest.fn().mockReturnValue('https://storage.example.com/avatars/some-key.jpg'),
      ensureBucket: jest.fn().mockResolvedValue(undefined),
    };
    usersRepository = { updateProfile: jest.fn().mockResolvedValue(profile) };
    service = new AvatarUploadService(
      storageProvider as unknown as StorageProvider,
      usersRepository as unknown as UsersRepository,
    );
  });

  const jpegFile = { buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/jpeg', size: 1024 };

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

  it('uploads to the avatars bucket under the user id, keyed with the right extension', async () => {
    await service.upload(user, jpegFile);

    expect(storageProvider.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: AVATAR_BUCKET,
        key: expect.stringMatching(new RegExp(`^${user.id}/.+\\.jpg$`)),
        body: jpegFile.buffer,
        contentType: 'image/jpeg',
      }),
    );
  });

  it('writes the public URL back onto the profile via the repository', async () => {
    await service.upload(user, jpegFile);

    expect(usersRepository.updateProfile).toHaveBeenCalledWith(user.id, {
      avatarUrl: 'https://storage.example.com/avatars/some-key.jpg',
    });
  });

  it('returns the new avatar URL', async () => {
    await expect(service.upload(user, jpegFile)).resolves.toEqual({
      avatarUrl: 'https://storage.example.com/avatars/some-key.jpg',
    });
  });

  it('throws NotFound when the profile row does not exist', async () => {
    usersRepository.updateProfile.mockResolvedValue(null);

    await expect(service.upload(user, jpegFile)).rejects.toBeInstanceOf(NotFoundException);
  });
});
