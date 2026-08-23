import { SubscriptionService } from './subscription.service';

/**
 * Trivial today because there is nothing behind it yet — billing is Phase 10 — but the seam
 * itself is what this test pins: every caller already goes through `getPlan` rather than
 * assuming `'free'` inline, so Phase 10 has exactly one function to change.
 */
describe('SubscriptionService', () => {
  const service = new SubscriptionService();

  it('reports free for any user', async () => {
    await expect(service.getPlan('11111111-1111-4111-8111-111111111111')).resolves.toBe('free');
    await expect(service.getPlan('22222222-2222-4222-8222-222222222222')).resolves.toBe('free');
  });
});
