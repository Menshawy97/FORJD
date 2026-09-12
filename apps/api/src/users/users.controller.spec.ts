import { updatePrivacyRequestSchema, updateProfileRequestSchema } from "@forjd/contracts";

import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { getBodySchema, getClassGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { AvatarUploadService } from "./avatar-upload.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  let usersService: jest.Mocked<UsersService>;
  let avatarUploadService: jest.Mocked<AvatarUploadService>;
  let controller: UsersController;

  beforeEach(() => {
    usersService = {
      getMe: jest.fn(),
      updateProfile: jest.fn(),
      updatePrivacy: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    avatarUploadService = { upload: jest.fn() } as unknown as jest.Mocked<AvatarUploadService>;
    controller = new UsersController(usersService, avatarUploadService);
  });

  it("carries JwtAuthGuard at the class level", () => {
    expect(getClassGuards(UsersController)).toContain(JwtAuthGuard);
  });

  it("binds updateProfile's body to updateProfileRequestSchema", () => {
    expect(getBodySchema(UsersController, "updateProfile")).toBe(updateProfileRequestSchema);
  });

  it("binds updatePrivacy's body to updatePrivacyRequestSchema", () => {
    expect(getBodySchema(UsersController, "updatePrivacy")).toBe(updatePrivacyRequestSchema);
  });

  it("getMe reads only the authenticated caller, never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.getMe(request);

    expect(usersService.getMe).toHaveBeenCalledWith(request.user);
  });

  it("updateProfile forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { displayName: "New Name" } as never;

    await controller.updateProfile(request, body);

    expect(usersService.updateProfile).toHaveBeenCalledWith(request.user, body);
  });

  it("uploadAvatar forwards request.user and the uploaded file to the avatar service", async () => {
    const request = fakeAuthenticatedRequest();
    const file = { buffer: Buffer.from("x"), mimetype: "image/png" } as never;

    await controller.uploadAvatar(request, file);

    expect(avatarUploadService.upload).toHaveBeenCalledWith(request.user, file);
  });

  it("updatePrivacy forwards request.user and the validated body", async () => {
    const request = fakeAuthenticatedRequest();
    const body = { profileVisibility: "private" } as never;

    await controller.updatePrivacy(request, body);

    expect(usersService.updatePrivacy).toHaveBeenCalledWith(request.user, body);
  });
});
