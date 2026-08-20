/**
 * Measures the latency of an authenticated request, so a change to how tokens are verified
 * can be argued from numbers instead of from belief.
 *
 * `GET /users/me` is the subject because it is the cheapest authenticated endpoint in the
 * API: one guard and one profile read. Whatever it costs is close to the floor every other
 * authenticated endpoint pays, which is exactly the quantity worth watching.
 *
 * Deliberately not part of CI. Timing on a shared runner measures the runner, and a
 * performance check that fails for reasons unrelated to the code gets disabled within a
 * fortnight.
 *
 * Usage — needs the API running and a real account on the configured Supabase project:
 *
 *   FORJD_EMAIL=you@example.com FORJD_PASSWORD='...' node scripts/perf/measure-auth-latency.ts
 *
 * Node 24 strips the types itself, so this needs no build step and no new dependency.
 */

const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1';
const email = process.env.FORJD_EMAIL;
const password = process.env.FORJD_PASSWORD;
const samples = Number(process.env.SAMPLES ?? 100);

/** Excluded from the statistics: the first requests pay for JIT warmup and TCP setup. */
const warmups = 5;

function percentile(sorted: readonly number[], p: number): number {
  // Nearest-rank. With ~100 samples the interpolating variants differ by noise, and this
  // one always returns a duration that was actually observed.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

async function login(): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    // The body may name why, but it may also carry a token on some other endpoint, so only
    // the status is printed.
    throw new Error(`Login failed with ${response.status}. Check the credentials and the API.`);
  }

  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}

async function timeOneRequest(token: string): Promise<number> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/users/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const elapsed = performance.now() - started;

  // Draining the body is part of the request. Skipping it would time the headers only.
  await response.arrayBuffer();

  if (!response.ok) {
    throw new Error(`GET /users/me returned ${response.status}`);
  }

  return elapsed;
}

async function main(): Promise<void> {
  if (!email || !password) {
    throw new Error('Set FORJD_EMAIL and FORJD_PASSWORD. They are never read from arguments.');
  }

  const token = await login();

  for (let i = 0; i < warmups; i += 1) {
    await timeOneRequest(token);
  }

  const durations: number[] = [];

  // Sequential on purpose. Concurrent requests would measure how well the event loop
  // interleaves them, not what one user waits for.
  for (let i = 0; i < samples; i += 1) {
    durations.push(await timeOneRequest(token));
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = durations.reduce((total, value) => total + value, 0) / durations.length;
  const ms = (value: number): string => `${value.toFixed(1)} ms`;

  console.log(`GET /users/me — ${samples} sequential requests against ${baseUrl}`);
  console.log(`  min  ${ms(sorted[0])}`);
  console.log(`  p50  ${ms(percentile(sorted, 50))}`);
  console.log(`  p95  ${ms(percentile(sorted, 95))}`);
  console.log(`  max  ${ms(sorted[sorted.length - 1])}`);
  console.log(`  mean ${ms(mean)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
