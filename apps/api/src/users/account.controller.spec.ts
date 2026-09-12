import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { AccountController } from "./account.controller";
import { AccountDeletionService } from "./account-deletion.service";
import { AccountExportService } from "./account-export.service";

describe("AccountController", () => {
  let deletionService: jest.Mocked<AccountDeletionService>;
  let exportService: jest.Mocked<AccountExportService>;
  let controller: AccountController;

  beforeEach(() => {
    deletionService = { deleteAccount: jest.fn() } as unknown as jest.Mocked<AccountDeletionService>;
    exportService = { exportAccount: jest.fn() } as unknown as jest.Mocked<AccountExportService>;
    controller = new AccountController(deletionService, exportService);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(AccountController)).toContain(JwtAuthGuard);
  });

  it("deletes only the authenticated caller's own account -- never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.deleteMe(request);

    expect(deletionService.deleteAccount).toHaveBeenCalledWith(request.user.id);
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
