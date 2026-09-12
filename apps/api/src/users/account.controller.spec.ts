import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { AccountController } from "./account.controller";
import { AccountDeletionService } from "./account-deletion.service";

describe("AccountController", () => {
  let service: jest.Mocked<AccountDeletionService>;
  let controller: AccountController;

  beforeEach(() => {
    service = { deleteAccount: jest.fn() } as unknown as jest.Mocked<AccountDeletionService>;
    controller = new AccountController(service);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(AccountController)).toContain(JwtAuthGuard);
  });

  it("deletes only the authenticated caller's own account -- never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.deleteMe(request);

    expect(service.deleteAccount).toHaveBeenCalledWith(request.user.id);
    expect(service.deleteAccount).toHaveBeenCalledTimes(1);
  });
});
