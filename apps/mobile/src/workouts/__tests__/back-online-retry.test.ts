// Owner decision 2026-10-14 (emulator walk finding 14): a workout finished without signal uploads soon after the
// signal returns, even if the person stays in the app. While the app is open, a tick checks: is anything waiting?
// Is the server reachable? Only then does it upload, straight away rather than after the queue's backoff. A tick
// while still offline uses up no upload attempts.
import { retryIfBackOnline } from '../back-online-retry';

function deps(over: { pending?: boolean; online?: boolean } = {}) {
  return {
    hasPending: jest.fn(async () => over.pending ?? true),
    ping: jest.fn(async () => over.online ?? true),
    uploadNow: jest.fn(async () => undefined),
  };
}

describe('retryIfBackOnline', () => {
  it('does nothing, and asks the server nothing, when no workout is waiting', async () => {
    const d = deps({ pending: false });

    await expect(retryIfBackOnline(d)).resolves.toBe('idle');
    expect(d.ping).not.toHaveBeenCalled();
    expect(d.uploadNow).not.toHaveBeenCalled();
  });

  it('stops without trying an upload while the server cannot be reached', async () => {
    const d = deps({ online: false });

    await expect(retryIfBackOnline(d)).resolves.toBe('offline');
    expect(d.uploadNow).not.toHaveBeenCalled();
  });

  it('uploads at once when something is waiting and the server answers', async () => {
    const d = deps();

    await expect(retryIfBackOnline(d)).resolves.toBe('uploaded');
    expect(d.uploadNow).toHaveBeenCalledTimes(1);
  });

  it('never throws: a failing step reads as offline', async () => {
    const d = deps();
    d.hasPending.mockRejectedValue(new Error('no database'));

    await expect(retryIfBackOnline(d)).resolves.toBe('offline');
  });
});
