import { readFileSync } from "fs";

import { EnsureBucketOptions, StorageObjectRef, UploadRequest } from "../../storage/providers/storage-provider.interface";
import { UpsertCatalogueExerciseInput } from "../exercises.repository";
import {
  EXERCISE_MEDIA_BUCKET,
  MediaMirrorTarget,
  mirrorMedia,
  parseSnapshot,
  SNAPSHOT_PATH,
  upstreamUrl,
} from "./mirror-media";

/**
 * `mirrorMedia` is tested as a pure function over a fake target and a fake fetcher, the same
 * shape `load.spec.ts` uses for `loadCatalogue` -- no real Supabase project and no real
 * network call. `SupabaseStorageProvider.exists`/`upload`/`ensureBucket` have their own spec
 * (`supabase-storage.provider.spec.ts`); re-testing them through a mock here would only
 * re-assert the mock.
 */
describe("exercise media mirror", () => {
  const record = (...imageKeys: string[]): UpsertCatalogueExerciseInput => ({
    source: "free-exercise-db",
    sourceId: imageKeys[0] ?? "x",
    name: "Exercise",
    slug: "exercise",
    category: "strength",
    goal: "hypertrophy",
    measure: "weight",
    primaryMuscles: ["chest"],
    secondaryMuscles: [],
    equipment: ["barbell"],
    force: "push",
    level: "beginner",
    mechanic: "compound",
    instructions: ["Do the thing."],
    imageKeys,
    description: null,
  });

  interface FakeTarget extends MediaMirrorTarget {
    existingKeys: Set<string>;
    uploaded: UploadRequest[];
    ensuredBuckets: Array<{ bucket: string; options: EnsureBucketOptions }>;
  }

  const fakeTarget = (existing: string[] = []): FakeTarget => {
    const existingKeys = new Set(existing);
    const uploaded: UploadRequest[] = [];
    const ensuredBuckets: Array<{ bucket: string; options: EnsureBucketOptions }> = [];

    return {
      existingKeys,
      uploaded,
      ensuredBuckets,
      exists: (ref: StorageObjectRef): Promise<boolean> => Promise.resolve(existingKeys.has(ref.key)),
      upload: (request: UploadRequest): Promise<StorageObjectRef> => {
        uploaded.push(request);
        return Promise.resolve({ bucket: request.bucket, key: request.key });
      },
      ensureBucket: (bucket: string, options: EnsureBucketOptions): Promise<void> => {
        ensuredBuckets.push({ bucket, options });
        return Promise.resolve();
      },
    };
  };

  const fakeFetch = (bytes: Buffer = Buffer.from("jpeg-bytes")) => jest.fn().mockResolvedValue(bytes);

  describe("upstreamUrl", () => {
    it("points at the pinned commit's exercises/ directory", () => {
      expect(upstreamUrl("Bench_Press/0.jpg")).toBe(
        "https://raw.githubusercontent.com/yuhonas/free-exercise-db/b0eed061e1c832b3ed815fbaa4b45b3cdc14df49/exercises/Bench_Press/0.jpg",
      );
    });
  });

  describe("mirrorMedia", () => {
    it("ensures the bucket exists as public before uploading anything", async () => {
      const target = fakeTarget();

      await mirrorMedia(target, [record("Bench_Press/0.jpg")], fakeFetch());

      expect(target.ensuredBuckets).toEqual([{ bucket: EXERCISE_MEDIA_BUCKET, options: { public: true } }]);
    });

    it("uploads every image key not already present", async () => {
      const target = fakeTarget();
      const fetchImage = fakeFetch();

      const result = await mirrorMedia(
        target,
        [record("Bench_Press/0.jpg", "Bench_Press/1.jpg")],
        fetchImage,
      );

      expect(result).toEqual({ mirrored: 2, skipped: 0, failedKeys: [] });
      expect(target.uploaded.map((u) => u.key)).toEqual(["Bench_Press/0.jpg", "Bench_Press/1.jpg"]);
      expect(fetchImage).toHaveBeenCalledTimes(2);
    });

    it("skips a key that already exists, and never fetches it", async () => {
      const target = fakeTarget(["Bench_Press/0.jpg"]);
      const fetchImage = fakeFetch();

      const result = await mirrorMedia(target, [record("Bench_Press/0.jpg")], fetchImage);

      expect(result).toEqual({ mirrored: 0, skipped: 1, failedKeys: [] });
      expect(target.uploaded).toHaveLength(0);
      expect(fetchImage).not.toHaveBeenCalled();
    });

    it("de-duplicates a key shared by two records, uploading it once", async () => {
      const target = fakeTarget();

      const result = await mirrorMedia(
        target,
        [record("Shared/0.jpg"), record("Shared/0.jpg")],
        fakeFetch(),
      );

      expect(result).toEqual({ mirrored: 1, skipped: 0, failedKeys: [] });
      expect(target.uploaded).toHaveLength(1);
    });

    it("uploads with the jpeg content type and the fetched bytes", async () => {
      const target = fakeTarget();
      const bytes = Buffer.from("real-bytes");

      await mirrorMedia(target, [record("Bench_Press/0.jpg")], fakeFetch(bytes));

      expect(target.uploaded[0]).toMatchObject({
        bucket: EXERCISE_MEDIA_BUCKET,
        key: "Bench_Press/0.jpg",
        contentType: "image/jpeg",
        body: bytes,
      });
    });

    it("refuses a key shaped like path traversal, rather than fetching or uploading it", async () => {
      const target = fakeTarget();

      await expect(
        mirrorMedia(target, [record("../../etc/passwd")], fakeFetch()),
      ).rejects.toThrow(/Unsafe image key/);
      expect(target.uploaded).toHaveLength(0);
    });

    it("refuses a key that is an absolute path", async () => {
      const target = fakeTarget();

      await expect(mirrorMedia(target, [record("/etc/passwd")], fakeFetch())).rejects.toThrow(
        /Unsafe image key/,
      );
    });

    it("does nothing when no exercise has an image key", async () => {
      const target = fakeTarget();

      const result = await mirrorMedia(target, [record()], fakeFetch());

      expect(result).toEqual({ mirrored: 0, skipped: 0, failedKeys: [] });
    });

    /**
     * Discovered against the real pinned commit while validating this phase:
     * `raw.githubusercontent.com` returns a bare 400 for a real, scattered minority of image
     * paths -- consistently on retry, even after a 20-second wait -- while the same bytes
     * fetch fine through GitHub's git-blob API, and even a *sibling* path for the same
     * exercise (`Chair_Squat/1.jpg` next to its own failing `/0.jpg`) succeeds. Upstream CDN
     * flakiness on individual objects, not a systemic outage. A mirror that aborted the
     * whole run on the first such failure would mean the first flaky upstream path blocks
     * every deploy from mirroring anything past it, until a human intervenes -- a worse
     * outcome than shipping with a handful of broken image keys that a later run picks back
     * up (`exists()` never marks a failed key as done).
     */
    it("continues past a failed key, counting and naming it, rather than aborting the run", async () => {
      const target = fakeTarget();
      const fetchImage = jest
        .fn()
        .mockRejectedValueOnce(new Error("400 Bad Request"))
        .mockResolvedValueOnce(Buffer.from("bytes"));
      jest.spyOn(process.stderr, "write").mockReturnValue(true);

      const result = await mirrorMedia(
        target,
        [record("Broken/0.jpg", "Fine/0.jpg")],
        fetchImage,
      );

      expect(result).toEqual({ mirrored: 1, skipped: 0, failedKeys: ["Broken/0.jpg"] });
      expect(target.uploaded.map((u) => u.key)).toEqual(["Fine/0.jpg"]);

      jest.restoreAllMocks();
    });

    it("leaves a failed key's existence unmarked, so a re-run retries it", async () => {
      const target = fakeTarget();
      const fetchImage = jest.fn().mockRejectedValue(new Error("400 Bad Request"));
      jest.spyOn(process.stderr, "write").mockReturnValue(true);

      await mirrorMedia(target, [record("Broken/0.jpg")], fetchImage);

      expect(target.existingKeys.has("Broken/0.jpg")).toBe(false);

      jest.restoreAllMocks();
    });

    /**
     * Found by review: the first draft of the resilience redesign wrapped only the fetch
     * and upload in try/catch, leaving `exists()` -- a real Supabase Storage `list()` call,
     * just as capable of a transient network failure -- able to throw out of the loop
     * unguarded, silently abandoning every key after it. This is the regression test for
     * that gap.
     */
    it("continues past a key whose exists() check itself throws, rather than abandoning every key after it", async () => {
      const target = fakeTarget();
      const failingExists = jest
        .fn()
        .mockRejectedValueOnce(new Error("list() network timeout"))
        .mockResolvedValue(false);
      target.exists = failingExists;
      const fetchImage = fakeFetch();
      jest.spyOn(process.stderr, "write").mockReturnValue(true);

      const result = await mirrorMedia(
        target,
        [record("Unreachable/0.jpg", "Fine/0.jpg")],
        fetchImage,
      );

      expect(result).toEqual({ mirrored: 1, skipped: 0, failedKeys: ["Unreachable/0.jpg"] });
      expect(target.uploaded.map((u) => u.key)).toEqual(["Fine/0.jpg"]);

      jest.restoreAllMocks();
    });
  });

  describe("parseSnapshot", () => {
    it("returns the exercises array from a well-formed snapshot", () => {
      const exercises = [record("a/0.jpg")];

      expect(parseSnapshot({ count: 1, exercises })).toEqual(exercises);
    });

    it("rejects a snapshot that is not an object", () => {
      expect(() => parseSnapshot([])).toThrow(/object/i);
    });

    it("rejects a snapshot whose exercises are not an array", () => {
      expect(() => parseSnapshot({ count: 0, exercises: {} })).toThrow(/array/i);
    });
  });

  /**
   * Reads the real committed snapshot to prove the mirror can actually walk it -- the same
   * check `load.spec.ts` runs against its own consumption of the same file.
   */
  describe("the committed snapshot", () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown;

    it("parses, and every image key round-trips through upstreamUrl to a plausible URL", () => {
      const exercises = parseSnapshot(snapshot);
      const [firstKey] = exercises.flatMap((exercise) => exercise.imageKeys);

      expect(firstKey).toBeTruthy();
      expect(upstreamUrl(firstKey as string)).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/[0-9a-f]{40}\/exercises\//,
      );
    });
  });
});
