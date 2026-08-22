// This is the Phase 3 "does Metro resolve pnpm's symlinked workspace packages" spike test.
// It has to succeed at the module-resolution level, not just the assertion level: a
// module-not-found error here means metro.config.js's symlink config is wrong, not that
// this test is wrong. See docs/decisions/ADR-013.md and the mobile-pivot plan's Phase 3.
import { loginRequestSchema } from '@forjd/contracts';

describe('workspace package resolution', () => {
  it('imports a real export from @forjd/contracts', () => {
    expect(loginRequestSchema).toBeDefined();
  });

  it('the imported schema behaves like a real Zod schema', () => {
    const result = loginRequestSchema.safeParse({
      email: 'user@example.com',
      password: 'anything',
    });
    expect(result.success).toBe(true);
  });
});
