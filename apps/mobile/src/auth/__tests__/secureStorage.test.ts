// Phase 5 RED: the full secureStorage.ts contract — save/clear a session, and the
// conformance guarantee that this is the only file in the app importing expo-secure-store
// (scripts/ci/check-architecture-conformance.sh enforces the same rule in CI once this file
// exists at exactly apps/mobile/src/auth/secureStorage.ts).
import fs from 'fs';
import path from 'path';

import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store');

describe('secureStorage conformance', () => {
  // Mirrors scripts/ci/check-architecture-conformance.sh's own grep exactly (same pattern,
  // same two exemptions) so this test fails locally for the same reason CI would.
  it('is the only module under src/ that imports expo-secure-store', () => {
    const srcDir = path.resolve(__dirname, '../../');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) {
          continue;
        }
        const relative = path
          .relative(path.resolve(__dirname, '../../..'), fullPath)
          .replace(/\\/g, '/');
        if (relative === 'src/auth/secureStorage.ts' || relative.includes('/__tests__/')) {
          continue;
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        if (/['"]expo-secure-store['"]/.test(content)) {
          offenders.push(relative);
        }
      }
    };

    walk(srcDir);

    expect(offenders).toEqual([]);
  });
});

describe('secureStorage - full session lifecycle (Phase 5)', () => {
  it('saveSession writes accessToken, refreshToken and expiresAt through the wrapper', () => {
    jest.isolateModules(() => {
      const SS = require('expo-secure-store');
      SS.setItemAsync.mockResolvedValue(undefined);
      const { saveSession } = require('../secureStorage');

      return saveSession({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }).then(() => {
        expect(SS.setItemAsync).toHaveBeenCalledWith('forjd.accessToken', 'access-1');
        expect(SS.setItemAsync).toHaveBeenCalledWith('forjd.refreshToken', 'refresh-1');
        expect(SS.setItemAsync).toHaveBeenCalledWith(
          'forjd.expiresAt',
          '2026-01-01T00:00:00.000Z',
        );
      });
    });
  });

  it('after saveSession, getAccessToken reads from the in-memory cache, not the store again', async () => {
    let saveSession: (typeof import('../secureStorage'))['saveSession'];
    let getAccessToken: (typeof import('../secureStorage'))['getAccessToken'];
    let SS: typeof SecureStore;

    jest.isolateModules(() => {
      SS = require('expo-secure-store');
      (SS.setItemAsync as jest.Mock).mockResolvedValue(undefined);
      ({ saveSession, getAccessToken } = require('../secureStorage'));
    });

    await saveSession!({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    (SS!.getItemAsync as jest.Mock).mockClear();

    await expect(getAccessToken!()).resolves.toBe('access-2');
    expect(SS!.getItemAsync).not.toHaveBeenCalled();
  });

  it('clearSession deletes every forjd.-prefixed key', async () => {
    let clearSession: (typeof import('../secureStorage'))['clearSession'];
    let SS: typeof SecureStore;

    jest.isolateModules(() => {
      SS = require('expo-secure-store');
      (SS.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
      ({ clearSession } = require('../secureStorage'));
    });

    await clearSession!();

    expect(SS!.deleteItemAsync).toHaveBeenCalledWith('forjd.accessToken');
    expect(SS!.deleteItemAsync).toHaveBeenCalledWith('forjd.refreshToken');
    expect(SS!.deleteItemAsync).toHaveBeenCalledWith('forjd.expiresAt');
    expect(SS!.deleteItemAsync).toHaveBeenCalledWith('forjd.userId');
    expect(SS!.deleteItemAsync).toHaveBeenCalledWith('forjd.email');
  });

  it('after clearSession, hasSession resolves false', async () => {
    let clearSession: (typeof import('../secureStorage'))['clearSession'];
    let hasSession: (typeof import('../secureStorage'))['hasSession'];
    let saveSession: (typeof import('../secureStorage'))['saveSession'];

    jest.isolateModules(() => {
      const SS = require('expo-secure-store');
      SS.setItemAsync.mockResolvedValue(undefined);
      SS.deleteItemAsync.mockResolvedValue(undefined);
      ({ clearSession, hasSession, saveSession } = require('../secureStorage'));
    });

    await saveSession!({
      accessToken: 'access-3',
      refreshToken: 'refresh-3',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    await clearSession!();

    await expect(hasSession!()).resolves.toBe(false);
  });
});
