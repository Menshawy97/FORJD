import { Injectable } from '@nestjs/common';
import { Plan } from '@forjd/domain';

/**
 * The single seam for the plan a user is on. Hardcoded to `'free'` because billing is
 * Phase 10 (see docs/product/slice-2-plan.md Phase E) — the `editProfile` screen's Plan row
 * renders as "Free plan" / "Go Pro" and is non-navigating.
 *
 * The point of a seam that currently does nothing is that every caller already asks it rather
 * than assuming `'free'` inline, so wiring in a real subscription lookup later is a change to
 * this one method rather than a search-and-replace across the codebase.
 *
 * Async on purpose, ahead of any present need: Phase 10 will read this from a billing table
 * or a payment provider, both genuine I/O, and every current caller already awaits the
 * profile read it accompanies. Starting synchronous would mean changing this method's
 * signature — and every caller — the moment Phase 10 actually needs it.
 */
@Injectable()
export class SubscriptionService {
  // userId is part of the interface every future implementation needs, not dead code — it is
  // simply unused by this one, which always answers 'free' regardless of who is asking.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getPlan(userId: string): Promise<Plan> {
    return 'free';
  }
}
