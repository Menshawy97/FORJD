import { createHmac } from "node:crypto";

import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { getClassGuards, getMethodGuards } from "../../test-support/controller-metadata";
import { fakeAuthenticatedRequest } from "../../test-support/fake-authenticated-request";
import { WhoopCallbackService } from "./whoop-callback.service";
import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WhoopOAuthService } from "./whoop-oauth.service";
import { WhoopProviderFactory } from "./whoop-provider.factory";
import { WhoopSyncService } from "./whoop-sync.service";
import { WhoopWebhookService } from "./whoop-webhook.service";
import { WhoopController } from "./whoop.controller";

const WEBHOOK_SECRET = "test-whoop-webhook-secret";

function sign(rawBody: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
}

describe("WhoopController", () => {
  let oauthService: jest.Mocked<WhoopOAuthService>;
  let connections: jest.Mocked<WhoopConnectionRepository>;
  let callbackService: jest.Mocked<WhoopCallbackService>;
  let syncService: jest.Mocked<WhoopSyncService>;
  let providerFactory: jest.Mocked<WhoopProviderFactory>;
  let webhookService: jest.Mocked<WhoopWebhookService>;
  let config: { getOrThrow: jest.Mock };
  let controller: WhoopController;

  beforeEach(() => {
    oauthService = { buildAuthorizeUrl: jest.fn().mockReturnValue("https://whoop.example/authorize") } as never;
    connections = {
      findByUserId: jest.fn(),
      setPendingState: jest.fn(),
    } as never;
    callbackService = { completeAuthorization: jest.fn() } as never;
    syncService = { syncUser: jest.fn() } as never;
    const disconnect = jest.fn();
    providerFactory = { forUser: jest.fn().mockReturnValue({ disconnect }) } as never;
    webhookService = { processEvent: jest.fn() } as never;
    config = { getOrThrow: jest.fn().mockReturnValue(WEBHOOK_SECRET) };

    controller = new WhoopController(
      oauthService,
      connections,
      callbackService,
      syncService,
      providerFactory,
      webhookService,
      config as never,
    );
  });

  it("carries no class-level guard -- guarding is opted into per-route", () => {
    expect(getClassGuards(WhoopController)).toEqual([]);
  });

  it("guards status/authorize/sync/disconnect with JwtAuthGuard", () => {
    expect(getMethodGuards(WhoopController, "status")).toContain(JwtAuthGuard);
    expect(getMethodGuards(WhoopController, "authorize")).toContain(JwtAuthGuard);
    expect(getMethodGuards(WhoopController, "sync")).toContain(JwtAuthGuard);
    expect(getMethodGuards(WhoopController, "disconnect")).toContain(JwtAuthGuard);
  });

  it("leaves callback and webhook unguarded -- WHOOP's own redirect and server-to-server calls carry no bearer token", () => {
    expect(getMethodGuards(WhoopController, "callback")).not.toContain(JwtAuthGuard);
    expect(getMethodGuards(WhoopController, "webhook")).not.toContain(JwtAuthGuard);
  });

  it("status scopes by request.user.id only", async () => {
    const request = fakeAuthenticatedRequest();
    connections.findByUserId.mockResolvedValue(null);

    await controller.status(request);

    expect(connections.findByUserId).toHaveBeenCalledWith(request.user.id);
  });

  it("authorize sets pending state under request.user.id, never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.authorize(request);

    expect(connections.setPendingState).toHaveBeenCalledWith(
      request.user.id,
      expect.any(String),
      expect.any(Date),
    );
  });

  it("sync scopes by request.user.id only", async () => {
    const request = fakeAuthenticatedRequest();
    syncService.syncUser.mockResolvedValue({ observationsWritten: 0 } as never);

    await controller.sync(request);

    expect(syncService.syncUser).toHaveBeenCalledWith(request.user.id);
  });

  it("disconnect scopes by request.user.id, never a client-supplied id", async () => {
    const request = fakeAuthenticatedRequest();

    await controller.disconnect(request);

    expect(providerFactory.forUser).toHaveBeenCalledWith(request.user.id);
  });

  describe("webhook", () => {
    function rawRequest(body: string, signature: string, timestamp: string) {
      return {
        rawBody: Buffer.from(body, "utf8"),
        headers: {
          "x-whoop-signature": signature,
          "x-whoop-signature-timestamp": timestamp,
        },
      } as never;
    }

    it("rejects an invalid signature without reaching the webhook service", async () => {
      const body = JSON.stringify({ user_id: 1, id: "evt-1", type: "recovery.updated", trace_id: "t-1" });
      const timestamp = Date.now().toString();

      await expect(controller.webhook(rawRequest(body, "bad-signature", timestamp))).rejects.toBeInstanceOf(
        Error,
      );
      expect(webhookService.processEvent).not.toHaveBeenCalled();
    });

    it("rejects a malformed payload even with a valid signature", async () => {
      const body = "{not json";
      const timestamp = Date.now().toString();
      const signature = sign(body, timestamp, WEBHOOK_SECRET);

      await expect(controller.webhook(rawRequest(body, signature, timestamp))).rejects.toBeInstanceOf(Error);
      expect(webhookService.processEvent).not.toHaveBeenCalled();
    });

    it("parses and forwards a validly signed event to the webhook service", async () => {
      const event = { user_id: 1, id: "evt-1", type: "recovery.updated", trace_id: "t-1" };
      const body = JSON.stringify(event);
      const timestamp = Date.now().toString();
      const signature = sign(body, timestamp, WEBHOOK_SECRET);

      await controller.webhook(rawRequest(body, signature, timestamp));

      expect(webhookService.processEvent).toHaveBeenCalledWith(event);
    });
  });
});
