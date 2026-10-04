// Phase 12C. The root layout owns the background upload's registration: registered while someone is
// signed in, unregistered when no one is. (The task is *defined* by the entry file, see
// `src/__tests__/background-task.test.ts`.) The seam itself is proven in
// `integrations/background/__tests__`; what is proven here is only the wiring.
import { renderApp } from './render-app';

const mockRegister = jest.fn();
const mockUnregister = jest.fn();

jest.mock('@/integrations/background/background-upload', () => ({
  registerBackgroundUpload: (...args: unknown[]) => mockRegister(...args),
  unregisterBackgroundUpload: (...args: unknown[]) => mockUnregister(...args),
}));

jest.mock('@/workouts/sync-sessions', () => ({
  syncPendingSessions: jest.fn().mockResolvedValue({ uploaded: [], failed: [] }),
}));

jest.mock('@/auth/secureStorage', () => ({
  getAccountId: jest.fn().mockResolvedValue('account-a'),
  hasSession: jest.fn(),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(),
  consumeSessionExpired: jest.fn(() => false),
}));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';

describe('root layout background upload', () => {
  beforeEach(() => {
    mockRegister.mockClear().mockResolvedValue('registered');
    mockUnregister.mockClear().mockResolvedValue(undefined);
  });

  it('registers the background upload once someone is signed in', async () => {
    (hasSession as jest.Mock).mockResolvedValue(true);
    (getCachedHasSession as jest.Mock).mockReturnValue(true);

    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText('Home');

    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('unregisters it, and does not register, when no one is signed in', async () => {
    (hasSession as jest.Mock).mockResolvedValue(false);
    (getCachedHasSession as jest.Mock).mockReturnValue(false);

    const { findByText } = await renderApp({ initialUrl: '/' });
    await findByText(/Training\./);

    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockUnregister).toHaveBeenCalled();
  });
});
