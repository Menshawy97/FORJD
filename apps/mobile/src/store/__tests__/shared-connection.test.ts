// docs/reviews/2026-10-14-emulator-walk.md, finding 2. expo-sqlite hands every open of the same file the
// same native connection, and closes it for everyone when any one JavaScript handle is garbage
// collected. A store that opened a fresh handle per call therefore lost its connection under a live
// workout or run ("Run not saved"). One handle per database, held for the life of the app, cannot be
// collected, so the connection cannot be closed underneath anyone.
import { sharedConnection } from '../shared-connection';

function fakeDb() {
  return { closeAsync: jest.fn().mockResolvedValue(undefined) };
}

describe('sharedConnection', () => {
  it('opens once and hands every caller the same connection', async () => {
    const db = fakeDb();
    const open = jest.fn().mockResolvedValue(db);
    const shared = sharedConnection(open);

    const [first, second] = await Promise.all([shared.get(), shared.get()]);
    const third = await shared.get();

    expect(open).toHaveBeenCalledTimes(1);
    expect(first).toBe(db);
    expect(second).toBe(db);
    expect(third).toBe(db);
  });

  it('tries again after a failed open instead of keeping the failure', async () => {
    const db = fakeDb();
    const open = jest.fn().mockRejectedValueOnce(new Error('disk busy')).mockResolvedValueOnce(db);
    const shared = sharedConnection(open);

    await expect(shared.get()).rejects.toThrow('disk busy');
    await expect(shared.get()).resolves.toBe(db);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('closes the connection on release, and the next get opens a new one', async () => {
    const first = fakeDb();
    const second = fakeDb();
    const open = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const shared = sharedConnection(open);

    await shared.get();
    await shared.release();

    expect(first.closeAsync).toHaveBeenCalledTimes(1);
    await expect(shared.get()).resolves.toBe(second);
  });

  it('makes a get during a release wait for the close, then open afresh', async () => {
    const first = fakeDb();
    const second = fakeDb();
    let finishClose: () => void = () => undefined;
    first.closeAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const open = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const shared = sharedConnection(open);
    await shared.get();

    const releasing = shared.release();
    const during = shared.get();
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);

    finishClose();
    await releasing;
    await expect(during).resolves.toBe(second);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('releases quietly when nothing was opened, or when the open had failed', async () => {
    const neverOpened = sharedConnection(jest.fn());
    await expect(neverOpened.release()).resolves.toBeUndefined();

    const failed = sharedConnection(jest.fn().mockRejectedValue(new Error('no file')));
    await expect(failed.get()).rejects.toThrow('no file');
    await expect(failed.release()).resolves.toBeUndefined();
  });
});
