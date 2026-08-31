import { readFileSync } from "fs";
import { join } from "path";

import {
  EnsureBucketOptions,
  StorageObjectRef,
  UploadRequest,
} from "../../storage/providers/storage-provider.interface";
import { createSupabaseStorageClient } from "../../storage/providers/supabase-storage-client";
import { SupabaseStorageProvider } from "../../storage/providers/supabase-storage.provider";
import { NormalizedExercise } from "./exercise-source-adapter.interface";

/**
 * `pnpm --filter @forjd/api exercises:mirror-media`
 *
 * ADR-018's stopgap, made real: fetches every image the committed catalogue snapshot
 * references from the pinned upstream commit and uploads it through `StorageProvider` into
 * a public `exercise-media` bucket -- never the Supabase SDK directly outside the provider
 * directory (rule 11). Runs in `deploy-api.yml` after `exercises:load`.
 *
 * **Idempotent.** `exists()` is checked before every upload, so a re-run after a partial
 * failure -- or simply the next deploy -- only fetches and uploads what is still missing.
 * Steady state after the first successful run is ~1,746 existence checks and zero uploads.
 *
 * **It reads the committed snapshot, never the raw dataset**, same reasoning as `load.ts`:
 * the snapshot is what a reviewer actually saw. The upstream commit this mirrors bytes from
 * is pinned separately, in `UPSTREAM_COMMIT` below, and must match `data/SOURCE.md`'s pin --
 * re-vendoring the dataset and re-pinning the media are two different, deliberate actions.
 */

export const EXERCISE_MEDIA_BUCKET = "exercise-media";

/** Must match the commit recorded in `data/SOURCE.md`. */
const UPSTREAM_COMMIT = "b0eed061e1c832b3ed815fbaa4b45b3cdc14df49";

export const SNAPSHOT_PATH = join(__dirname, "data", "normalized-exercises.json");

/**
 * The slice of `StorageProvider` the mirror uses, named structurally -- same pattern as
 * `load.ts`'s `CatalogueTarget` -- so the pure function below is testable against a fake
 * without a real Supabase project.
 */
export interface MediaMirrorTarget {
  exists(ref: StorageObjectRef): Promise<boolean>;
  upload(request: UploadRequest): Promise<StorageObjectRef>;
  ensureBucket(bucket: string, options: EnsureBucketOptions): Promise<void>;
}

interface SnapshotShape {
  count: number;
  exercises: NormalizedExercise[];
}

/**
 * free-exercise-db's `images` field is already a repo-relative path (`Bench_Press/0.jpg`),
 * carried through unchanged into `imageKeys` by the adapter (Phase D) -- see
 * `free-exercise-db.adapter.ts`. Upstream, the same path lives one directory down, under
 * `exercises/`.
 */
export function upstreamUrl(key: string): string {
  return `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${UPSTREAM_COMMIT}/exercises/${key}`;
}

/**
 * Every image in this dataset is a `.jpg` (measured at Phase A: 1,746 image paths, all
 * `.jpg`, none missing). A source that ever ships a different extension needs this taught a
 * real content-type map -- hardcoding `image/jpeg` here would then upload a PNG mislabelled,
 * which is why the assumption is stated rather than left implicit.
 */
const IMAGE_CONTENT_TYPE = "image/jpeg";

/** Two exercises never share an image key in today's dataset, but nothing guarantees it. */
/**
 * `imageKeys` comes from the committed, reviewed snapshot rather than live user input, so
 * this is not defending against a hostile actor -- it is the same "truncated, not hostile"
 * posture `load.ts`'s `parseSnapshot` takes. But the key is interpolated directly into both
 * an outbound URL and a Storage object path, so a `..`-shaped or absolute-path key from a
 * bad hand-edit or a future, less-trusted source would silently mean something other than
 * what it looks like -- rejecting it here is cheap and turns that into a loud failure
 * instead.
 */
function isPathSafe(key: string): boolean {
  return key.length > 0 && !key.startsWith("/") && !key.split("/").includes("..");
}

function uniqueKeys(exercises: NormalizedExercise[]): string[] {
  const keys = exercises.flatMap((exercise) => exercise.imageKeys);
  const unsafe = keys.find((key) => !isPathSafe(key));
  if (unsafe !== undefined) {
    throw new Error(`Unsafe image key: ${JSON.stringify(unsafe)}`);
  }

  return Array.from(new Set(keys));
}

/**
 * Sequential, like `loadCatalogue`: each key is one existence check plus, at most, one fetch
 * and one upload, and a burst of concurrent requests against the same free-tier Supabase
 * project buys nothing but rate-limit risk on a step that runs once per deploy. There is no
 * partial-failure rollback either -- a run that dies halfway leaves a partially mirrored
 * bucket that the next run, or the next deploy, completes; `exists()` is what makes that
 * safe.
 *
 * **No single key's failure aborts the run -- `exists()` included.** Observed against the
 * real pinned commit while validating this phase: `raw.githubusercontent.com` returns a bare
 * `400` for a real, non-trivial minority of image paths -- consistently on retry, even after
 * a 20-second wait, while the identical bytes fetch cleanly through GitHub's git-blob API,
 * and adjacent paths for the very same exercise (`Chair_Squat/1.jpg` vs. its own failing
 * `/0.jpg`) succeed. That is upstream CDN flakiness scattered across individual objects, not
 * a systemic outage -- and the original design here (fail the whole run on the first error,
 * `load.ts`'s philosophy for a truncated snapshot) would have meant the first flaky path
 * blocking every deploy from mirroring anything past it, until a human intervened. `exists()`
 * is inside the same try/catch as the fetch and upload, for the same reason: a transient
 * Storage `list()` failure is exactly as recoverable as a transient fetch failure, and
 * treating it differently would silently skip every key after the one that hit it. Each
 * key's failure is caught, counted, and named in `failedKeys`; the run finishes, mirrors
 * everything it can, and the caller decides how loud to be about the rest. Because a failed
 * key is never marked as existing, the next run retries it for free.
 */
export async function mirrorMedia(
  target: MediaMirrorTarget,
  exercises: NormalizedExercise[],
  fetchImage: (url: string) => Promise<Buffer>,
  bucket: string = EXERCISE_MEDIA_BUCKET,
): Promise<{ mirrored: number; skipped: number; failedKeys: string[] }> {
  await target.ensureBucket(bucket, { public: true });

  let mirrored = 0;
  let skipped = 0;
  const failedKeys: string[] = [];

  for (const key of uniqueKeys(exercises)) {
    const ref: StorageObjectRef = { bucket, key };

    // `exists()` is inside the same try/catch as the fetch and upload it gates -- a
    // transient Storage `list()` failure (network blip, rate limit) is exactly the class of
    // error the fetch/upload resilience below exists for, and letting it throw out of the
    // loop unguarded would silently skip every key after it, undoing the point of catching
    // per-key failures at all. Found by review, not by a test: nothing in the original spec
    // exercised an `exists()` rejection mid-loop.
    try {
      if (await target.exists(ref)) {
        skipped += 1;
        continue;
      }

      const body = await fetchImage(upstreamUrl(key));
      await target.upload({ ...ref, body, contentType: IMAGE_CONTENT_TYPE });
      mirrored += 1;
    } catch (error: unknown) {
      failedKeys.push(key);
      // Deploy-step script, not request-serving code -- stderr here is the operator's only
      // per-key signal, same as load.ts's own process.stderr.write in its CLI half.
      process.stderr.write(
        `mirror failed for ${key}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  return { mirrored, skipped, failedKeys };
}

export function parseSnapshot(raw: unknown): NormalizedExercise[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${SNAPSHOT_PATH}: expected a JSON object at the top level.`);
  }

  const { exercises } = raw as Partial<SnapshotShape>;

  if (!Array.isArray(exercises)) {
    throw new Error(`${SNAPSHOT_PATH}: "exercises" is not an array.`);
  }

  return exercises;
}

/** The CLI half: everything that touches the network or builds a real Supabase client. */
async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
  }

  const client = createSupabaseStorageClient(supabaseUrl, supabaseServiceRoleKey);
  const provider = new SupabaseStorageProvider(client);

  const exercises = parseSnapshot(JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown);

  const fetchImage = async (url: string): Promise<Buffer> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url}: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  };

  const { mirrored, skipped, failedKeys } = await mirrorMedia(provider, exercises, fetchImage);
  process.stdout.write(`mirrored ${mirrored} images, skipped ${skipped} already present\n`);

  if (failedKeys.length > 0) {
    process.stdout.write(`${failedKeys.length} key(s) failed and will be retried next run:\n`);
    failedKeys.forEach((key) => process.stdout.write(`  ${key}\n`));
    // Non-zero, but only after every mirrorable key was attempted: a deploy that ignored
    // this would silently ship broken images; a deploy that never finished the other 1,745
    // over one flaky path would be worse.
    process.exitCode = 1;
  }
}

// Importing this file (the spec does) must never open a network connection.
if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
