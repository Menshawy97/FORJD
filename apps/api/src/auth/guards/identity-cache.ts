import { Injectable, Optional } from '@nestjs/common';
import { User } from '@forjd/domain';

export interface IdentityCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

/**
 * Short-lived memory of which internal user an external identity resolves to.
 *
 * Once token verification stopped touching the network (ADR-012), the remaining per-request
 * cost was the `users` lookup behind it. This removes that for repeat requests inside a
 * short window, which is what a client scrolling a screen actually generates.
 *
 * Two properties are deliberate rather than incidental:
 *
 * - The key includes the email, so an identity presenting a *different* address misses and
 *   goes back to the repository. That matters because the repository is where an address
 *   already bound to another account is rejected; keying on the external id alone would
 *   let a cache hit skip that check.
 * - Capacity is bounded. A map keyed by user id that is only ever written to is a memory
 *   leak whose severity scales with how well the product does.
 */
@Injectable()
export class IdentityCache {
  private readonly entries = new Map<string, { user: User; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  // `@Optional()`, or Nest treats the parameter as a dependency it must resolve and the
  // whole application fails to start. The unit tests cannot catch that: they construct
  // this class directly, so only wiring it into the container reveals it.
  constructor(@Optional() options?: Partial<IdentityCacheOptions>) {
    // A minute is long enough to cover a burst of requests from one screen and short
    // enough that a deleted or re-pointed account corrects itself without intervention.
    this.ttlMs = options?.ttlMs ?? 60_000;
    this.maxEntries = options?.maxEntries ?? 10_000;
  }

  get size(): number {
    return this.entries.size;
  }

  get(externalId: string, email: string): User | undefined {
    const key = this.keyFor(externalId, email);
    const hit = this.entries.get(key);

    if (!hit) {
      return undefined;
    }

    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return hit.user;
  }

  set(externalId: string, email: string, user: User): void {
    // A Map iterates in insertion order, so the first key is the oldest. That makes this
    // first-in-first-out rather than least-recently-used — cheaper, and with a one-minute
    // window the difference is not worth a linked list.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();

      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }

    this.entries.set(this.keyFor(externalId, email), {
      user,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  private keyFor(externalId: string, email: string): string {
    // A newline cannot appear in either part, so no value can be crafted to collide with
    // a different pair.
    return `${externalId}\n${email}`;
  }
}
