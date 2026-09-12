import { revokeAndClearWhoopConnection } from '../integrations/whoop/whoop-revoke';
import { AccountDeletionService } from './account-deletion.service';

jest.mock('../integrations/whoop/whoop-revoke', () => ({
  revokeAndClearWhoopConnection: jest.fn().mockResolvedValue(undefined),
}));

/**
 * C1 -- no account-deletion path existed at all. Health observations, body scans, nutrition
 * logs, profile and WHOOP tokens persisted forever; cascades were wired but nothing ever
 * deleted the parent row, and InBody scan photos in Supabase Storage had no FK and were never
 * removed even when their row cascaded.
 *
 * `db.delete(users)` and the storage/WHOOP orchestration are exercised here against fakes;
 * the orphan assertion across every real table is `test/users-deletion.e2e-spec.ts`, which
 * needs the real cascades this unit suite cannot see.
 */
describe('AccountDeletionService', () => {
  const scanKeys = ['user-1/scan-a.webp', 'user-1/scan-b.webp'];

  function build(overrides: { avatarUrl?: string | null; scans?: string[] } = {}) {
    const deleteCalls: unknown[] = [];
    const deleteResults = new Map<string, () => Promise<void>>();

    const storageProvider = {
      delete: jest.fn(async (ref: { bucket: string; key: string }) => {
        deleteCalls.push(ref);
        const throwFn = deleteResults.get(ref.key);
        if (throwFn) await throwFn();
      }),
    };

    const bodyRepository = {
      listScanPhotoKeysForUser: jest.fn().mockResolvedValue(overrides.scans ?? scanKeys),
    };

    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(
            'avatarUrl' in overrides
              ? overrides.avatarUrl === null
                ? []
                : [{ avatarUrl: overrides.avatarUrl }]
              : [{ avatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/user-1/pic.webp' }],
          ),
        }),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    };

    const service = new AccountDeletionService(
      db as never,
      storageProvider as never,
      bodyRepository as never,
      {} as never, // WhoopConnectionRepository -- opaque here, revokeAndClearWhoopConnection is mocked whole
      {} as never, // WHOOP_CLIENT
      {} as never, // TOKEN_CIPHER
    );

    return { service, storageProvider, bodyRepository, db, deleteResults };
  }

  it('deletes every scan photo and the avatar from storage, using the exact keys', async () => {
    const { service, storageProvider } = build();

    await service.deleteAccount('user-1');

    expect(storageProvider.delete).toHaveBeenCalledWith({ bucket: 'inbody', key: scanKeys[0] });
    expect(storageProvider.delete).toHaveBeenCalledWith({ bucket: 'inbody', key: scanKeys[1] });
    expect(storageProvider.delete).toHaveBeenCalledWith({ bucket: 'avatars', key: 'user-1/pic.webp' });
  });

  it('skips the avatar deletion when the user never set one', async () => {
    const { service, storageProvider } = build({ avatarUrl: null });

    await service.deleteAccount('user-1');

    const avatarCalls = (storageProvider.delete as jest.Mock).mock.calls.filter(
      ([ref]) => ref.bucket === 'avatars',
    );
    expect(avatarCalls).toHaveLength(0);
  });

  it('revokes and wipes the WHOOP grant before deleting the user row', async () => {
    const { service, db } = build();
    const order: string[] = [];
    (revokeAndClearWhoopConnection as jest.Mock).mockImplementation(async () => {
      order.push('whoop');
    });
    (db.delete as jest.Mock).mockReturnValue({
      where: jest.fn().mockImplementation(async () => {
        order.push('delete-user');
      }),
    });

    await service.deleteAccount('user-1');

    expect(revokeAndClearWhoopConnection).toHaveBeenCalledWith('user-1', {}, {}, {});
    expect(order).toEqual(['whoop', 'delete-user']);
  });

  it('does not abort when one storage delete fails -- the row deletion still runs', async () => {
    const { service, storageProvider, db } = build();
    storageProvider.delete.mockImplementationOnce(async () => {
      throw new Error('object not found');
    });

    await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
  });

  it('deletes the user row last', async () => {
    const { service, db, bodyRepository } = build();
    const order: string[] = [];
    bodyRepository.listScanPhotoKeysForUser.mockImplementation(async () => {
      order.push('list-scans');
      return scanKeys;
    });
    (db.delete as jest.Mock).mockReturnValue({
      where: jest.fn().mockImplementation(async () => {
        order.push('delete-user');
      }),
    });

    await service.deleteAccount('user-1');

    expect(order.indexOf('delete-user')).toBe(order.length - 1);
  });

  it('is idempotent: a second call on an already-deleted user does not throw', async () => {
    const { service, bodyRepository, db } = build();
    bodyRepository.listScanPhotoKeysForUser.mockResolvedValue([]);
    db.select.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

    await service.deleteAccount('user-1');
    await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
  });
});
