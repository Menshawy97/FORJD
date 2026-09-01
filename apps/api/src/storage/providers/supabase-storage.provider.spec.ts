import { InternalServerErrorException, NotFoundException } from '@nestjs/common';

import { SupabaseStorageProvider } from './supabase-storage.provider';

/**
 * The client is injected (see `supabase-storage-client.ts`) precisely so it can be stubbed
 * here instead of verified only by hand against a live project — the same fix, same
 * reasoning, as `supabase-auth.provider.spec.ts`.
 */
interface StorageStub {
  upload: jest.Mock;
  createSignedUrl: jest.Mock;
  remove: jest.Mock;
  list: jest.Mock;
  getPublicUrl: jest.Mock;
}

describe('SupabaseStorageProvider', () => {
  let storage: StorageStub;
  let provider: SupabaseStorageProvider;

  beforeEach(() => {
    storage = {
      upload: jest.fn(),
      createSignedUrl: jest.fn(),
      remove: jest.fn(),
      list: jest.fn(),
      getPublicUrl: jest.fn(),
    };

    const client = { storage: { from: jest.fn().mockReturnValue(storage), createBucket: jest.fn() } };
    provider = new SupabaseStorageProvider(client as never);
  });

  describe('upload', () => {
    it('returns the ref on success', async () => {
      storage.upload.mockResolvedValue({ error: null });

      await expect(
        provider.upload({ bucket: 'b', key: 'k.jpg', body: Buffer.from(''), contentType: 'image/jpeg' }),
      ).resolves.toEqual({ bucket: 'b', key: 'k.jpg' });
    });

    it('throws when the provider reports an error', async () => {
      storage.upload.mockResolvedValue({ error: { message: 'disk full' } });

      await expect(
        provider.upload({ bucket: 'b', key: 'k.jpg', body: Buffer.from(''), contentType: 'image/jpeg' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('getSignedUrl', () => {
    it('returns the signed URL on success', async () => {
      storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/y' }, error: null });

      await expect(provider.getSignedUrl({ bucket: 'b', key: 'k.jpg' }, 60)).resolves.toBe(
        'https://x/y',
      );
    });

    it('reports a missing object as not found, not a raw provider error', async () => {
      storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'not found' } });

      await expect(provider.getSignedUrl({ bucket: 'b', key: 'k.jpg' }, 60)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('resolves on success', async () => {
      storage.remove.mockResolvedValue({ error: null });

      await expect(provider.delete({ bucket: 'b', key: 'k.jpg' })).resolves.toBeUndefined();
    });

    it('throws when the provider reports an error', async () => {
      storage.remove.mockResolvedValue({ error: { message: 'nope' } });

      await expect(provider.delete({ bucket: 'b', key: 'k.jpg' })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('exists', () => {
    it('splits the key into a folder and filename and asks for that filename', async () => {
      storage.list.mockResolvedValue({ data: [{ name: '0.jpg' }], error: null });

      await expect(provider.exists({ bucket: 'b', key: 'Bench_Press/0.jpg' })).resolves.toBe(true);
      expect(storage.list).toHaveBeenCalledWith('Bench_Press', { search: '0.jpg', limit: 1 });
    });

    it('treats a key with no folder as living at the bucket root', async () => {
      storage.list.mockResolvedValue({ data: [], error: null });

      await provider.exists({ bucket: 'b', key: 'flat.jpg' });

      expect(storage.list).toHaveBeenCalledWith('', { search: 'flat.jpg', limit: 1 });
    });

    it('returns false when the listing is empty', async () => {
      storage.list.mockResolvedValue({ data: [], error: null });

      await expect(provider.exists({ bucket: 'b', key: 'Bench_Press/0.jpg' })).resolves.toBe(false);
    });

    it('does not treat a same-folder near-miss name as a match', async () => {
      storage.list.mockResolvedValue({ data: [{ name: '0.jpg.bak' }], error: null });

      await expect(provider.exists({ bucket: 'b', key: 'Bench_Press/0.jpg' })).resolves.toBe(false);
    });

    it('throws when the provider reports an error', async () => {
      storage.list.mockResolvedValue({ data: null, error: { message: 'nope' } });

      await expect(provider.exists({ bucket: 'b', key: 'Bench_Press/0.jpg' })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  /** ADR-019's avatar upload -- the first request-serving caller of this method. */
  describe('getPublicUrl', () => {
    it('returns the URL Supabase builds, synchronously, with no network call', () => {
      storage.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://x/avatars/k.jpg' } });

      const result = provider.getPublicUrl({ bucket: 'avatars', key: 'k.jpg' });

      expect(result).toBe('https://x/avatars/k.jpg');
      expect(storage.getPublicUrl).toHaveBeenCalledWith('k.jpg');
    });
  });

  describe('ensureBucket', () => {
    it('resolves when the bucket is created', async () => {
      const client = { storage: { from: jest.fn(), createBucket: jest.fn().mockResolvedValue({ error: null }) } };
      provider = new SupabaseStorageProvider(client as never);

      await expect(provider.ensureBucket('exercise-media', { public: true })).resolves.toBeUndefined();
      expect(client.storage.createBucket).toHaveBeenCalledWith('exercise-media', { public: true });
    });

    it('treats "already exists" as success, the expected steady state after the first deploy', async () => {
      const client = {
        storage: {
          from: jest.fn(),
          createBucket: jest.fn().mockResolvedValue({ error: { message: 'Bucket already exists' } }),
        },
      };
      provider = new SupabaseStorageProvider(client as never);

      await expect(provider.ensureBucket('exercise-media', { public: true })).resolves.toBeUndefined();
    });

    it('still throws on an unrelated error', async () => {
      const client = {
        storage: {
          from: jest.fn(),
          createBucket: jest.fn().mockResolvedValue({ error: { message: 'invalid credentials' } }),
        },
      };
      provider = new SupabaseStorageProvider(client as never);

      await expect(provider.ensureBucket('exercise-media', { public: true })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });
});
