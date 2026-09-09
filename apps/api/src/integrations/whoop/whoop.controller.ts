import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";

import { AuthenticatedRequest, JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { WhoopCallbackService } from "./whoop-callback.service";
import { WhoopConnectionRepository } from "./whoop-connection.repository";
import { WhoopOAuthService } from "./whoop-oauth.service";
import { WhoopProviderFactory } from "./whoop-provider.factory";
import { WhoopSyncService, type WhoopSyncResult } from "./whoop-sync.service";
import { WhoopWebhookEvent, WhoopWebhookService } from "./whoop-webhook.service";
import { verifyWhoopWebhookSignature } from "./whoop-webhook-signature";

/** WHOOP's own documented webhook payload shape (`user_id, id, type, trace_id`). Validated
 *  here, not in `@forjd/contracts` -- this is server-to-server with WHOOP, never a shape the
 *  mobile client sends or receives. */
const whoopWebhookEventSchema = z.object({
  user_id: z.number(),
  id: z.string(),
  type: z.string(),
  trace_id: z.string(),
}) satisfies z.ZodType<WhoopWebhookEvent>;

/** WHOOP's OAuth state minimum, mirrored here (rather than only in `WhoopOAuthService`) so a
 *  state this route generates never itself violates the rule the authorize URL enforces. */
const OAUTH_STATE_BYTES = 16;
const OAUTH_STATE_TTL_MS = 10 * 60_000;

/**
 * Follows `auth.controller.ts`'s shape: a public class, with `JwtAuthGuard` opted into only
 * on the three routes that need an authenticated caller. `authorize`/`sync`/the `DELETE`
 * disconnect route are authenticated; `callback` (WHOOP's own browser redirect) and
 * `webhook` (a server-to-server call from WHOOP) are necessarily public, per
 * `docs/product/phase-7-plan.md` slice 7F.
 */
@Controller("integrations/whoop")
export class WhoopController {
  constructor(
    private readonly oauthService: WhoopOAuthService,
    private readonly connections: WhoopConnectionRepository,
    private readonly callbackService: WhoopCallbackService,
    private readonly syncService: WhoopSyncService,
    private readonly providerFactory: WhoopProviderFactory,
    private readonly webhookService: WhoopWebhookService,
    private readonly config: ConfigService,
  ) {}

  @Post("authorize")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async authorize(@Req() request: AuthenticatedRequest): Promise<{ authorizeUrl: string }> {
    const state = randomBytes(OAUTH_STATE_BYTES).toString("base64url");
    await this.connections.setPendingState(request.user.id, state, new Date(Date.now() + OAUTH_STATE_TTL_MS));
    return { authorizeUrl: this.oauthService.buildAuthorizeUrl(state) };
  }

  /**
   * Public: this is WHOOP's own browser redirect landing back in the app, carrying no
   * Authorization header of ours -- `state` alone is what identifies the internal user
   * (`WhoopCallbackService`). Always redirects into the app's own URL scheme rather than
   * returning JSON; there is no API client waiting on this response, only a browser.
   */
  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const redirectWithStatus = (status: "success" | "error", reason?: string): void => {
      const query = reason ? `status=${status}&reason=${reason}` : `status=${status}`;
      response.redirect(`forjd://whoop-callback?${query}`);
    };

    if (!code || !state) {
      redirectWithStatus("error", "missing_params");
      return;
    }

    let result;
    try {
      result = await this.callbackService.completeAuthorization(state, code);
    } catch {
      redirectWithStatus("error", "exchange_failed");
      return;
    }

    if (!result) {
      redirectWithStatus("error", "invalid_state");
      return;
    }

    redirectWithStatus("success");
  }

  @Post("sync")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  sync(@Req() request: AuthenticatedRequest): Promise<WhoopSyncResult> {
    return this.syncService.syncUser(request.user.id);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.providerFactory.forUser(request.user.id).disconnect();
  }

  /**
   * Public and unauthenticated by nature (a server-to-server call from WHOOP, not a user
   * request) -- `@SkipThrottle()` because the global `ThrottlerGuard` rate-limits by IP, and
   * WHOOP delivers every subscriber's webhooks from its own small set of IPs.
   */
  @Post("webhook")
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() request: RawBodyRequest<Request>): Promise<void> {
    const rawBody = request.rawBody?.toString("utf8") ?? "";
    const signature = request.headers["x-whoop-signature"];
    const timestamp = request.headers["x-whoop-signature-timestamp"];

    const isValid =
      typeof signature === "string" &&
      typeof timestamp === "string" &&
      verifyWhoopWebhookSignature({
        rawBody,
        timestamp,
        signature,
        secret: this.config.getOrThrow<string>("WHOOP_WEBHOOK_SECRET"),
      });

    if (!isValid) {
      throw new UnauthorizedException("Invalid WHOOP webhook signature");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException("Malformed webhook payload");
    }

    const event = new ZodValidationPipe(whoopWebhookEventSchema).transform(parsedBody);
    await this.webhookService.processEvent(event);
  }
}
