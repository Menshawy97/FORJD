import { ForbiddenException } from "@nestjs/common";
import type { User } from "@forjd/domain";

import { PrivacyService } from "../privacy/privacy.service";
import { VisionProvider } from "../ai/providers/vision-provider.interface";
import { StorageProvider } from "../storage/providers/storage-provider.interface";
import { BodyRepository } from "./body.repository";
import { BodyService } from "./body.service";

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
