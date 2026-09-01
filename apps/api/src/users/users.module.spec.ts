import { StorageProvider } from '../storage/providers/storage-provider.interface';
import { AVATAR_BUCKET } from './avatar-upload.service';
import { UsersModule } from './users.module';

/**
 * `UsersModule` is instantiated directly rather than through Nest's `Test.createTestingModule`
 * -- it is a plain class with one constructor dependency and one lifecycle method, and building
 * the real DI graph (which needs `DATABASE_URL`, Supabase env vars, etc.) would test the whole
 * app's wiring to check one call. See the comment on `onModuleInit` for why `ensureBucket` is
 * called here rather than inside `AvatarUploadService.upload`.
 */
describe('UsersModule', () => {
  it('ensures the avatars bucket exists as public on module init', async () => {
    const storageProvider = { ensureBucket: jest.fn().mockResolvedValue(undefined) };
    const module = new UsersModule(storageProvider as unknown as StorageProvider);

    await module.onModuleInit();

    expect(storageProvider.ensureBucket).toHaveBeenCalledWith(AVATAR_BUCKET, { public: true });
  });
});
