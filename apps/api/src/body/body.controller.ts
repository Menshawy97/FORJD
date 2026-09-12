import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { confirmBodyScanRequestSchema } from "@forjd/contracts";
import type {
  BodyScanListResponse,
  BodyScanResponse,
  BodyScanSeriesResponse,
  ExtractBodyScanResponse,
} from "@forjd/contracts";

import { AuthenticatedRequest, JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { BodyService, MAX_SCAN_PHOTO_BYTES, UploadedScanPhoto } from "./body.service";

@Controller("body-scans")
@UseGuards(JwtAuthGuard)
export class BodyController {
  constructor(private readonly bodyService: BodyService) {}

  /**
   * Saves nothing -- see BodyService.extract's own docblock. Throttled tighter than the
   * global 60/min default: each call is a billable vision inference on a free-tier budget,
   * and the global limit alone permits roughly 86,000 of them a day per account.
   */
  @Post("extract")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SCAN_PHOTO_BYTES } }))
  extract(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedScanPhoto,
  ): Promise<ExtractBodyScanResponse> {
    return this.bodyService.extract(request.user, file);
  }

  /**
   * Multipart, not JSON: `file` is the same photo re-sent (the extract step above stores
   * nothing to reference back to), `data` is the confirmed values as a JSON string field,
   * validated here rather than via `ZodValidationPipe` -- that pipe expects a parsed body
   * object, and a multipart request's non-file fields arrive as strings.
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_SCAN_PHOTO_BYTES } }))
  confirm(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file: UploadedScanPhoto,
    @Body("data") data: string | undefined,
  ): Promise<BodyScanResponse> {
    if (!data) {
      throw new BadRequestException("Missing data field");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new BadRequestException("data field is not valid JSON");
    }

    const result = confirmBodyScanRequestSchema.safeParse(parsed);
    if (!result.success) {
      throw new BadRequestException(result.error.message);
    }

    return this.bodyService.confirm(request.user, file, result.data);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<BodyScanListResponse> {
    return this.bodyService.listScans(request.user);
  }

  /** Registered before `:id` -- Nest resolves routes in declaration order, and `series`
   *  would otherwise be swallowed by the `:id` route below and treated as a scan id. */
  @Get("series")
  series(@Req() request: AuthenticatedRequest): Promise<BodyScanSeriesResponse> {
    return this.bodyService.getSeries(request.user);
  }

  @Get(":id")
  get(@Req() request: AuthenticatedRequest, @Param("id") id: string): Promise<BodyScanResponse> {
    return this.bodyService.getScan(request.user, id);
  }
}
