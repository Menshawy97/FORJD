import { ALLOW_WITHOUT_DATE_OF_BIRTH } from "../auth/guards/allow-without-date-of-birth.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { setDateOfBirthRequestSchema } from "@forjd/contracts";
import { AgeGateService } from "./age-gate.service";
import { getBodySchema, getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { AccountController } from "./account.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { AccountExportService } from "./account-export.service";

describe("AccountController", () => {
  let deletionService: jest.Mocked<AccountDeletionService>;
  let exportService: jest.Mocked<AccountExportService>;
  let ageGate: jest.Mocked<AgeGateService>;
  let controller: AccountController;

  beforeEach(() => {
    deletionService = { deleteAccount: jest.fn() } as unknown as jest.Mocked<AccountDeletionService>;
    exportService = { exportAccount: jest.fn() } as unknown as jest.Mocked<AccountExportService>;
    ageGate = { setDateOfBirth: jest.fn() } as unknown as jest.Mocked<AgeGateService>;
    controller = new AccountController(deletionService, exportService, ageGate);
  });

  it("hands the verified caller and the validated date of birth to the age gate", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.setDateOfBirth(request, { dateOfBirth: "1990-01-01" });

    expect(ageGate.setDateOfBirth).toHaveBeenCalledWith(
      { userId: request.user.id, email: request.user.email, externalId: request.identity.externalId },
      "1990-01-01",
    );
  });

  it("validates the date-of-birth body against setDateOfBirthRequestSchema", () => {
    expect(getBodySchema(AccountController, "setDateOfBirth")).toBe(setDateOfBirthRequestSchema);
  });

  it.each(["setDateOfBirth", "deleteMe", "exportMe"] as const)(
    "%s stays reachable for an account with no date of birth yet (ADR-042)",
    (method) => {
      expect(Reflect.getMetadata(ALLOW_WITHOUT_DATE_OF_BIRTH, AccountController.prototype[method])).toBe(true);
    },
  );

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(AccountController)).toContain(JwtAuthGuard);
  });

  it("deletes only the authenticated caller's own account -- never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.deleteMe(request);

    expect(deletionService.deleteAccount).toHaveBeenCalledWith({
      userId: request.user.id,
      email: request.user.email,
      externalId: request.identity.externalId,
    });
    expect(deletionService.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("exports only the authenticated caller's own account -- never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();
    const expected = { version: 1 } as never;
    exportService.exportAccount.mockResolvedValue(expected);

    const result = await controller.exportMe(request);

    expect(exportService.exportAccount).toHaveBeenCalledWith(request.user.id, request.user.email);
    expect(exportService.exportAccount).toHaveBeenCalledTimes(1);
    expect(result).toBe(expected);
  });
});
