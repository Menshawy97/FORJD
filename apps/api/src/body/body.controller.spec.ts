import { BadRequestException } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { BodyController } from "./body.controller";
import { BodyService } from "./body.service";

describe("BodyController", () => {
  let service: jest.Mocked<BodyService>;
  let controller: BodyController;

  beforeEach(() => {
    service = {
      extract: jest.fn(),
      confirm: jest.fn(),
      listScans: jest.fn(),
      getSeries: jest.fn(),
      getScan: jest.fn(),
    } as unknown as jest.Mocked<BodyService>;
    controller = new BodyController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(BodyController)).toContain(JwtAuthGuard);
  });

  describe("extract", () => {
    it("forwards request.user and the uploaded file to the service", async () => {
      const request = fakeAuthenticatedRequest();
      const file = { buffer: Buffer.from("x"), mimetype: "image/png" } as never;

      await controller.extract(request, file);

      expect(service.extract).toHaveBeenCalledWith(request.user, file);
    });
  });

  describe("confirm", () => {
    it("rejects a request with no data field without reaching the service", () => {
      const request = fakeAuthenticatedRequest();
      const file = { buffer: Buffer.from("x"), mimetype: "image/png" } as never;

      expect(() => controller.confirm(request, file, undefined)).toThrow(BadRequestException);
      expect(service.confirm).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON in the data field without reaching the service", () => {
      const request = fakeAuthenticatedRequest();
      const file = { buffer: Buffer.from("x"), mimetype: "image/png" } as never;

      expect(() => controller.confirm(request, file, "{not json")).toThrow(BadRequestException);
      expect(service.confirm).not.toHaveBeenCalled();
    });

    it("rejects JSON that fails confirmBodyScanRequestSchema without reaching the service", () => {
      const request = fakeAuthenticatedRequest();
      const file = { buffer: Buffer.from("x"), mimetype: "image/png" } as never;

      expect(() => controller.confirm(request, file, JSON.stringify({ nonsense: true }))).toThrow(
        BadRequestException,
      );
      expect(service.confirm).not.toHaveBeenCalled();
    });

    it("forwards request.user, the file and the parsed body on success", async () => {
      const request = fakeAuthenticatedRequest();
      const file = { buffer: Buffer.from("x"), mimetype: "image/png" } as never;
      const payload = {
        measuredAt: new Date().toISOString(),
        measurements: [{ metric: "weight_kg", value: 80, unit: "kg", confidence: 0.9 }],
      };

      await controller.confirm(request, file, JSON.stringify(payload));

      expect(service.confirm).toHaveBeenCalledWith(
        request.user,
        file,
        expect.objectContaining({ measurements: expect.any(Array) }),
      );
      const callerArg = service.confirm.mock.calls[0]?.[0];
      expect(callerArg).toBe(request.user);
    });
  });

  describe("list / series", () => {
    it("list scopes by request.user only", async () => {
      const request = fakeAuthenticatedRequest();
      await controller.list(request);
      expect(service.listScans).toHaveBeenCalledWith(request.user);
    });

    it("series scopes by request.user only", async () => {
      const request = fakeAuthenticatedRequest();
      await controller.series(request);
      expect(service.getSeries).toHaveBeenCalledWith(request.user);
    });
  });

  describe("get", () => {
    it("passes request.user and the path id through -- the service, not the controller, enforces ownership", async () => {
      const request = fakeAuthenticatedRequest();
      const someScanId = "33333333-3333-4333-8333-333333333333";

      await controller.get(request, someScanId);

      expect(service.getScan).toHaveBeenCalledWith(request.user, someScanId);
      const callerArg = service.getScan.mock.calls[0]?.[0];
      expect(callerArg).toBe(request.user);
    });
  });
});
