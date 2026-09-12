import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
} from "@forjd/contracts";

import { getBodySchema, getClassGuards, getMethodGuards } from "../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../test-support/fake-authenticated-request";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

describe("AuthController", () => {
  let service: jest.Mocked<AuthService>;
  let controller: AuthController;

  beforeEach(() => {
    service = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      requestPasswordReset: jest.fn(),
      logout: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;
    controller = new AuthController(service);
  });

  describe("guarding", () => {
    it("carries no class-level guard -- register/login/refresh/forgot-password are public credential endpoints", () => {
      expect(getClassGuards(AuthController)).toEqual([]);
    });

    it("guards logout with JwtAuthGuard so the audit entry names a real user", () => {
      expect(getMethodGuards(AuthController, "logout")).toContain(JwtAuthGuard);
    });

    it("does not guard register/login/refresh/forgotPassword", () => {
      expect(getMethodGuards(AuthController, "register")).not.toContain(JwtAuthGuard);
      expect(getMethodGuards(AuthController, "login")).not.toContain(JwtAuthGuard);
      expect(getMethodGuards(AuthController, "refresh")).not.toContain(JwtAuthGuard);
      expect(getMethodGuards(AuthController, "forgotPassword")).not.toContain(JwtAuthGuard);
    });
  });

  describe("Zod schema wiring", () => {
    it("binds register to registerRequestSchema", () => {
      expect(getBodySchema(AuthController, "register")).toBe(registerRequestSchema);
    });

    it("binds login to loginRequestSchema", () => {
      expect(getBodySchema(AuthController, "login")).toBe(loginRequestSchema);
    });

    it("binds refresh to refreshRequestSchema", () => {
      expect(getBodySchema(AuthController, "refresh")).toBe(refreshRequestSchema);
    });

    it("binds forgotPassword to forgotPasswordRequestSchema", () => {
      expect(getBodySchema(AuthController, "forgotPassword")).toBe(forgotPasswordRequestSchema);
    });
  });

  describe("logout", () => {
    it("takes the user id from request.user, never the request body", async () => {
      const request = fakeAuthenticatedRequest();
      request.headers.authorization = "Bearer a-real-token";

      await controller.logout(request);

      expect(service.logout).toHaveBeenCalledWith("a-real-token", request.user.id);
    });

    it("does not call the service when there is no bearer token", async () => {
      const request = fakeAuthenticatedRequest();

      await controller.logout(request);

      expect(service.logout).not.toHaveBeenCalled();
    });
  });

  describe("service contract", () => {
    it("passes the validated body straight through to register", async () => {
      const body = { email: "new@example.com", password: "hunter2-hunter2" } as never;
      await controller.register(body);
      expect(service.register).toHaveBeenCalledWith(body);
    });

    it("passes the validated body straight through to login", async () => {
      const body = { email: "new@example.com", password: "hunter2-hunter2" } as never;
      await controller.login(body);
      expect(service.login).toHaveBeenCalledWith(body);
    });

    it("passes only the refresh token through to refresh", async () => {
      const body = { refreshToken: "a-refresh-token" };
      await controller.refresh(body);
      expect(service.refresh).toHaveBeenCalledWith(body.refreshToken);
    });

    it("passes only the email through to forgotPassword", async () => {
      const body = { email: "someone@example.com" };
      await controller.forgotPassword(body);
      expect(service.requestPasswordReset).toHaveBeenCalledWith(body.email);
    });
  });
});
