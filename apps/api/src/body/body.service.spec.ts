import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { User } from "@forjd/domain";

import { PrivacyService } from "../privacy/privacy.service";
import { VisionProvider } from "../ai/providers/vision-provider.interface";
import { StorageProvider } from "../storage/providers/storage-provider.interface";
import { BodyRepository } from "./body.repository";
import { BodyService, MAX_SCAN_PHOTO_BYTES } from "./body.service";

/**
 * C2 -- `extract()` sent an identifiable person's health document to a third-party vision
 * model with no read of `aiFeaturesConsent` at all. The flag and its audit log were fully
 * built and simply never consulted on this path. These tests pin the fail-closed gate: no
 * consent read, no vision call, ever.
 */
describe("BodyService -- AI consent gate (C2)", () => {
  const user: User = { id: "user-1", email: "athlete@example.com" } as User;

  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const file = { buffer: TINY_PNG, mimetype: "image/png", size: TINY_PNG.length };

  function build(aiFeaturesConsent: boolean) {
    const privacyService: Pick<PrivacyService, "get"> = {
      get: jest.fn().mockResolvedValue({ aiFeaturesConsent } as never),
    };
    const visionProvider: Pick<VisionProvider, "extractBodyScan"> = {
      extractBodyScan: jest.fn().mockResolvedValue({
        inbodyModel: "570",
        testDate: "2026-01-15",
        fields: {},
        segmental: {},
        imageQualityNotes: "",
      }),
    };
    const storageProvider: Pick<StorageProvider, "upload"> = {
      upload: jest.fn().mockResolvedValue({ bucket: "inbody", key: "user-1/scan.webp" }),
    };
    const bodyRepository: Pick<BodyRepository, "createScan" | "getScanById"> = {
      createScan: jest.fn().mockResolvedValue("scan-1"),
      getScanById: jest.fn().mockResolvedValue({
        id: "scan-1",
        measuredAt: new Date("2026-01-15T09:00:00.000Z"),
        measurements: [],
      }),
    };

    const service = new BodyService(
      visionProvider as VisionProvider,
      storageProvider as StorageProvider,
      bodyRepository as BodyRepository,
      privacyService as PrivacyService,
    );

    return { service, privacyService, visionProvider, storageProvider, bodyRepository };
  }

  describe("extract", () => {
    it("throws ForbiddenException and never calls the vision provider when consent is false", async () => {
      const { service, visionProvider } = build(false);

      await expect(service.extract(user, file)).rejects.toBeInstanceOf(ForbiddenException);
      expect(visionProvider.extractBodyScan).not.toHaveBeenCalled();
    });

    it("proceeds to the vision provider when consent is true", async () => {
      const { service, visionProvider } = build(true);

      await expect(service.extract(user, file)).resolves.toBeDefined();
      expect(visionProvider.extractBodyScan).toHaveBeenCalledTimes(1);
    });

    it("reads consent before re-encoding the image, so a non-consenting user's photo is never decoded", async () => {
      const { service, visionProvider } = build(false);
      // A file whose bytes would fail `sharp`'s decode -- if reencode ran before the consent
      // check, this would throw BadRequestException instead of ForbiddenException.
      const corrupt = { buffer: Buffer.from("not an image"), mimetype: "image/png", size: 12 };

      await expect(service.extract(user, corrupt)).rejects.toBeInstanceOf(ForbiddenException);
      expect(visionProvider.extractBodyScan).not.toHaveBeenCalled();
    });
  });

  describe("confirm", () => {
    const request = {
      measuredAt: "2026-01-15T09:00:00.000Z",
      measurements: [{ metric: "weight_kg" as const, value: 84.6, unit: "kg", confidence: 0.97 }],
    };

    it("throws ForbiddenException and never uploads or stores when consent is false", async () => {
      const { service, storageProvider, bodyRepository } = build(false);

      await expect(service.confirm(user, file, request)).rejects.toBeInstanceOf(ForbiddenException);
      expect(storageProvider.upload).not.toHaveBeenCalled();
      expect(bodyRepository.createScan).not.toHaveBeenCalled();
    });

    it("proceeds when consent is true", async () => {
      const { service } = build(true);

      await expect(service.confirm(user, file, request)).resolves.toBeDefined();
    });
  });
});

/**
 * R14 (H9) -- these methods are the caller's only guard against reading another user's body
 * data: the repository is trusted to scope by whatever id it is called with, so the thing
 * worth pinning here is that the service always calls it with `user.id`, never a bare
 * `scanId` or any other value, and that a repository "not found for this caller" answer
 * becomes a 404, not a silent pass-through of someone else's scan.
 */
describe("BodyService -- scan/series reads scope by user.id (H9)", () => {
  const user: User = { id: "user-1", email: "athlete@example.com" } as User;

  function build() {
    const privacyService: Pick<PrivacyService, "get"> = {
      get: jest.fn().mockResolvedValue({ aiFeaturesConsent: true } as never),
    };
    const visionProvider: Pick<VisionProvider, "extractBodyScan"> = {
      extractBodyScan: jest.fn(),
    };
    const storageProvider: Pick<StorageProvider, "upload"> = {
      upload: jest.fn(),
    };
    const bodyRepository: Pick<
      BodyRepository,
      "getScanById" | "listScansForUser" | "getSeriesForUser"
    > = {
      getScanById: jest.fn().mockResolvedValue(null),
      listScansForUser: jest.fn().mockResolvedValue([]),
      getSeriesForUser: jest.fn().mockResolvedValue([]),
    };

    const service = new BodyService(
      visionProvider as VisionProvider,
      storageProvider as StorageProvider,
      bodyRepository as BodyRepository,
      privacyService as PrivacyService,
    );

    return { service, bodyRepository };
  }

  describe("getScan", () => {
    it("calls getScanById with (user.id, scanId), never scanId alone or any other id", async () => {
      const { service, bodyRepository } = build();

      await expect(service.getScan(user, "scan-belonging-to-someone-else")).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(bodyRepository.getScanById).toHaveBeenCalledTimes(1);
      expect(bodyRepository.getScanById).toHaveBeenCalledWith(user.id, "scan-belonging-to-someone-else");
    });

    it("throws NotFoundException, not the other user's scan, when the repository finds nothing for this caller", async () => {
      // Simulates the exact case the audit flagged: a scan id that exists, but belongs to a
      // different user. Because `getScanById` is called with the caller's own `user.id`, the
      // repository's own userId predicate (proven in body.repository.spec.ts) makes that scan
      // invisible to this caller -- it resolves null, and the service must not treat that as
      // "not found yet, try again without scoping" or return anything.
      const { service, bodyRepository } = build();
      (bodyRepository.getScanById as jest.Mock).mockResolvedValue(null);

      await expect(service.getScan(user, "someone-elses-scan-id")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listScans", () => {
    it("calls listScansForUser with user.id", async () => {
      const { service, bodyRepository } = build();

      await service.listScans(user);

      expect(bodyRepository.listScansForUser).toHaveBeenCalledWith(user.id);
    });
  });

  describe("getSeries", () => {
    it("calls getSeriesForUser with user.id", async () => {
      const { service, bodyRepository } = build();

      await service.getSeries(user);

      expect(bodyRepository.getSeriesForUser).toHaveBeenCalledWith(user.id);
    });
  });
});

/**
 * R14 (H9) -- `reencode` is the one place every accepted photo passes through before it is
 * ever handed to `sharp` or the vision provider. These tests pin the boundary at the point
 * where the check runs, not just that some error eventually surfaces: neither `sharp` nor the
 * vision provider should ever see a disallowed MIME type or an oversized buffer.
 */
describe("BodyService -- photo re-encode boundary rejects bad uploads before sharp/vision (H9)", () => {
  const user: User = { id: "user-1", email: "athlete@example.com" } as User;
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  function build() {
    const privacyService: Pick<PrivacyService, "get"> = {
      get: jest.fn().mockResolvedValue({ aiFeaturesConsent: true } as never),
    };
    const visionProvider: Pick<VisionProvider, "extractBodyScan"> = {
      extractBodyScan: jest.fn().mockResolvedValue({
        inbodyModel: "570",
        testDate: "2026-01-15",
        fields: {},
        segmental: {},
        imageQualityNotes: "",
      }),
    };
    const storageProvider: Pick<StorageProvider, "upload"> = {
      upload: jest.fn(),
    };
    const bodyRepository: Pick<BodyRepository, "createScan" | "getScanById"> = {
      createScan: jest.fn(),
      getScanById: jest.fn(),
    };

    const service = new BodyService(
      visionProvider as VisionProvider,
      storageProvider as StorageProvider,
      bodyRepository as BodyRepository,
      privacyService as PrivacyService,
    );

    return { service, visionProvider };
  }

  it("rejects a disallowed MIME type with BadRequestException, without calling the vision provider", async () => {
    const { service, visionProvider } = build();
    const gif = { buffer: TINY_PNG, mimetype: "image/gif", size: TINY_PNG.length };

    await expect(service.extract(user, gif)).rejects.toBeInstanceOf(BadRequestException);
    expect(visionProvider.extractBodyScan).not.toHaveBeenCalled();
  });

  it("rejects an oversized buffer with BadRequestException, without calling the vision provider", async () => {
    const { service, visionProvider } = build();
    // `file.size` alone drives the check -- the buffer itself need not actually be this large,
    // since a real 10MB+ decode isn't needed to prove the boundary runs before sharp/vision.
    const oversized = { buffer: TINY_PNG, mimetype: "image/png", size: MAX_SCAN_PHOTO_BYTES + 1 };

    await expect(service.extract(user, oversized)).rejects.toBeInstanceOf(BadRequestException);
    expect(visionProvider.extractBodyScan).not.toHaveBeenCalled();
  });
});

/**
 * Manual entry (docs/product/manual-inbody-entry-plan.md): values typed in with no photo.
 * Nothing goes to the vision model or to storage, so -- unlike extract/confirm -- no AI
 * consent is required; the values are the user's own, so each is stored at confidence 1.
 */
describe("BodyService -- manual entry", () => {
  const user: User = { id: "user-1", email: "athlete@example.com" } as User;

  function build() {
    const privacyService = { get: jest.fn() };
    const visionProvider = { extractBodyScan: jest.fn() };
    const storageProvider = { upload: jest.fn() };
    const bodyRepository = {
      createScan: jest.fn().mockResolvedValue("scan-9"),
      getScanById: jest.fn().mockResolvedValue({
        id: "scan-9",
        measuredAt: new Date("2026-09-24T09:15:00.000Z"),
        source: "manual",
        measurements: [{ metric: "weight_kg", value: 82.4, unit: "kg", confidence: 1 }],
      }),
      listScansForUser: jest.fn(),
    };
    const service = new BodyService(
      visionProvider as unknown as VisionProvider,
      storageProvider as unknown as StorageProvider,
      bodyRepository as unknown as BodyRepository,
      privacyService as unknown as PrivacyService,
    );
    return { service, privacyService, visionProvider, storageProvider, bodyRepository };
  }

  const request = {
    measuredAt: "2026-09-24T09:15:00.000Z",
    measurements: [
      { metric: "weight_kg" as const, value: 82.4, unit: "kg" },
      { metric: "body_fat_percent" as const, value: 12.1, unit: "%" },
    ],
  };

  it("saves with source 'manual', no photo, and confidence 1 per value", async () => {
    const { service, bodyRepository } = build();

    await service.createManual(user, request);

    expect(bodyRepository.createScan).toHaveBeenCalledWith(
      "user-1",
      new Date("2026-09-24T09:15:00.000Z"),
      "manual",
      null,
      [
        { metric: "weight_kg", value: 82.4, unit: "kg", confidence: 1 },
        { metric: "body_fat_percent", value: 12.1, unit: "%", confidence: 1 },
      ],
    );
  });

  it("never reads AI consent, calls the vision model, or touches storage", async () => {
    const { service, privacyService, visionProvider, storageProvider } = build();

    await service.createManual(user, request);

    expect(privacyService.get).not.toHaveBeenCalled();
    expect(visionProvider.extractBodyScan).not.toHaveBeenCalled();
    expect(storageProvider.upload).not.toHaveBeenCalled();
  });

  it("returns the saved scan with its manual source", async () => {
    const { service } = build();

    await expect(service.createManual(user, request)).resolves.toMatchObject({ id: "scan-9", source: "manual" });
  });

  it("reports a stored scan's real source rather than assuming InBody", async () => {
    const { service } = build();

    await expect(service.getScan(user, "scan-9")).resolves.toMatchObject({ source: "manual" });
  });

  it("includes each scan's source on the history list", async () => {
    const { service, bodyRepository } = build();
    bodyRepository.listScansForUser.mockResolvedValue([
      { id: "scan-9", measuredAt: new Date("2026-09-24T09:15:00.000Z"), source: "manual", measurements: [] },
      { id: "scan-1", measuredAt: new Date("2026-08-11T09:15:00.000Z"), source: "inbody", measurements: [] },
    ]);

    const list = await service.listScans(user);

    expect(list.scans.map((scan) => scan.source)).toEqual(["manual", "inbody"]);
  });
});
