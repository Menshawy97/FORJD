import { revokeAndClearWhoopConnection } from '../integrations/whoop/whoop-revoke';
import { auditLogs } from '../database/schema/audit-logs.schema';
import { users } from '../database/schema/users.schema';
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

  const target = { userId: 'user-1', email: 'a@example.com', externalId: 'ext-1' as string | null };

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

    const profileRows =
      'avatarUrl' in overrides
        ? overrides.avatarUrl === null
          ? []
          : [{ avatarUrl: overrides.avatarUrl }]
        : [{ avatarUrl: 'https://x.supabase.co/storage/v1/object/public/avatars/user-1/pic.webp' }];

    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockImplementation((table: unknown) => ({
          where: jest.fn().mockResolvedValue(table === users ? [] : profileRows),
        })),
      }),
      delete: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    };

    const authProvider = { deleteUser: jest.fn().mockResolvedValue(undefined) };
    const identityCache = { evict: jest.fn() };

    const service = new AccountDeletionService(
      db as never,
      storageProvider as never,
      bodyRepository as never,
      {} as never, // WhoopConnectionRepository -- opaque here, revokeAndClearWhoopConnection is mocked whole
      {} as never, // WHOOP_CLIENT
      {} as never, // TOKEN_CIPHER
      authProvider as never,
      identityCache as never,
    );

    return { service, storageProvider, bodyRepository, db, deleteResults, authProvider, identityCache };
  }

  it('deletes every scan photo and the avatar from storage, using the exact keys', async () => {
    const { service, storageProvider } = build();

    await service.deleteAccount(target);

    expect(storageProvider.delete).toHaveBeenCalledWith({ bucket: 'inbody', key: scanKeys[0] });
    expect(storageProvider.delete).toHaveBeenCalledWith({ bucket: 'inbody', key: scanKeys[1] });
    expect(storageProvider.delete).toHaveBeenCalledWith({ bucket: 'avatars', key: 'user-1/pic.webp' });
  });

  it('skips the avatar deletion when the user never set one', async () => {
    const { service, storageProvider } = build({ avatarUrl: null });

    await service.deleteAccount(target);

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

    await service.deleteAccount(target);

    expect(revokeAndClearWhoopConnection).toHaveBeenCalledWith('user-1', {}, {}, {});
    expect(order.indexOf('whoop')).toBeLessThan(order.indexOf('delete-user'));
  });

  it('does not abort when one storage delete fails -- the row deletion still runs', async () => {
    const { service, storageProvider, db } = build();
    storageProvider.delete.mockImplementationOnce(async () => {
      throw new Error('object not found');
    });

    await expect(service.deleteAccount(target)).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
  });

  it('deletes the user row after storage, and only then the auth-provider user', async () => {
    const { service, db, bodyRepository, authProvider } = build();
    const order: string[] = [];
    authProvider.deleteUser.mockImplementation(async () => {
      order.push('delete-auth-user');
    });
    bodyRepository.listScanPhotoKeysForUser.mockImplementation(async () => {
      order.push('list-scans');
      return scanKeys;
    });
    (db.delete as jest.Mock).mockReturnValue({
      where: jest.fn().mockImplementation(async () => {
        order.push('delete-user');
      }),
    });

    await service.deleteAccount(target);

    expect(order.indexOf('list-scans')).toBeLessThan(order.indexOf('delete-user'));
    expect(order[order.length - 1]).toBe('delete-auth-user');
    expect(order.indexOf('delete-user')).toBeLessThan(order.indexOf('delete-auth-user'));
  });

  it('is idempotent: a second call on an already-deleted user does not throw', async () => {
    const { service, bodyRepository, db } = build();
    bodyRepository.listScanPhotoKeysForUser.mockResolvedValue([]);
    db.select.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

    await service.deleteAccount(target);
    await expect(service.deleteAccount(target)).resolves.toBeUndefined();
  });
  it('removes the Supabase auth user, so the account cannot sign back in', async () => {
    const { service, authProvider } = build();

    await service.deleteAccount(target);

    expect(authProvider.deleteUser).toHaveBeenCalledWith('ext-1');
  });

  it('skips the auth-provider call when the login has no external id', async () => {
    const { service, authProvider } = build();

    await service.deleteAccount({ ...target, externalId: null });

    expect(authProvider.deleteUser).not.toHaveBeenCalled();
  });

  it('still removes the auth-provider login when nothing else is left to delete (a retry after a partial failure)', async () => {
    const { service, authProvider, bodyRepository } = build();
    bodyRepository.listScanPhotoKeysForUser.mockResolvedValue([]);

    await service.deleteAccount(target);

    expect(authProvider.deleteUser).toHaveBeenCalledWith('ext-1');
  });

  it('forgets the cached identity so a stale entry cannot resolve to the deleted user', async () => {
    const { service, identityCache } = build();

    await service.deleteAccount(target);

    expect(identityCache.evict).toHaveBeenCalledWith('ext-1', 'a@example.com');
  });

  it('scrubs password-reset audit rows that hold the address, before deleting the user row', async () => {
    const { service, db } = build();
    const tables: unknown[] = [];
    (db.delete as jest.Mock).mockImplementation((table: unknown) => {
      tables.push(table);
      return { where: jest.fn().mockResolvedValue(undefined) };
    });

    await service.deleteAccount(target);

    expect(tables).toEqual([auditLogs, users]);
  });

  it('surfaces an auth-provider failure so the client can retry, rather than swallowing it', async () => {
    const { service, authProvider } = build();
    authProvider.deleteUser.mockRejectedValue(new Error('supabase down'));

    await expect(service.deleteAccount(target)).rejects.toThrow('supabase down');
  });
});
