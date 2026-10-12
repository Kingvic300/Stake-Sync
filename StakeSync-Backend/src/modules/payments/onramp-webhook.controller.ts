import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth.js';
import { requestInfo } from '../../core/logs/request-logger.js';
import { OnrampWebhookService } from './onramp-webhook.service.js';

@Controller('payments/onramp')
export class OnrampWebhookController {
  constructor(private readonly webhooks: OnrampWebhookService) {}

  /**
   * Transaction updates from Onramper. Authenticated by the payload signature, not a session, so it's
   * public. No DTO: the signature is checked against the raw bytes, and the payload carries fields
   * we don't use. Onramper sends from shared addresses, hence the higher per-IP limit.
   */
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post('webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Headers('x-onramper-webhook-signature') signature?: string) {
    return this.webhooks.receive(req.rawBody, signature, requestInfo(req));
  }

  /** Transaction updates from LocalRamp, authenticated by the token set in its dashboard. */
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post('localramp/webhook')
  @HttpCode(200)
  receiveLocalRamp(@Req() req: RawBodyRequest<Request>, @Headers('localramp-webhook-token') token?: string) {
    return this.webhooks.receiveLocalRamp(req.rawBody, token, requestInfo(req));
  }
}
