import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth.js';
import { SignatureDto } from '../challenges/dto/challenge.dto.js';
import { OnrampWebhookService } from './onramp-webhook.service.js';
import { PaymentsService } from './payments.service.js';

class SponsorDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  org?: string;
}

class SendDto {
  @IsString()
  @Length(32, 44)
  to: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount: number;
}

class SendConfirmDto extends SignatureDto {
  @IsUUID()
  sendId: string;

  @IsString()
  @Length(32, 44)
  to: string;
}

class OnrampDto {
  @IsIn(['buy', 'sell'])
  mode: 'buy' | 'sell';

  /** ISO currency code, e.g. NGN, GHS, KES, USD. */
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/)
  fiat?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount?: number;
}

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly onrampEvents: OnrampWebhookService,
  ) {}

  @Get('wallet')
  wallet(@CurrentUser() user: AuthUser) {
    return this.payments.summary(user.id);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query('before') before?: string) {
    return this.payments.history(user.id, before);
  }

  @Post('claims/:challengeId')
  claim(@CurrentUser() user: AuthUser, @Param('challengeId') id: string) {
    return this.payments.claim(user.id, id);
  }

  @Post('claims/:challengeId/confirm')
  confirmClaim(@CurrentUser() user: AuthUser, @Param('challengeId') id: string, @Body() dto: SignatureDto) {
    return this.payments.confirmClaim(user.id, id, dto.signature);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sponsor/:challengeId')
  sponsor(@CurrentUser() user: AuthUser, @Param('challengeId') id: string, @Body() dto: SponsorDto) {
    return this.payments.sponsor(user.id, id, dto.amount, dto.org);
  }

  @Post('sponsorships/:id/confirm')
  confirmSponsor(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SignatureDto) {
    return this.payments.confirmSponsor(id, dto.signature, user.id);
  }

  @Get('sponsorships')
  sponsorships(@CurrentUser() user: AuthUser) {
    return this.payments.mySponsorships(user.id);
  }

  @Post('sponsorships/:id/reclaim')
  reclaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.reclaimSponsorship(user.id, id);
  }

  @Post('sponsorships/:id/reclaim/confirm')
  confirmReclaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SignatureDto) {
    return this.payments.confirmReclaim(user.id, id, dto.signature);
  }

  // ---------- sending USDC to another wallet ----------

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('send')
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Body() dto: SendDto) {
    return this.payments.sendUsdc(user.id, dto.to, dto.amount);
  }

  @Post('send/confirm')
  @HttpCode(200)
  confirmSend(@CurrentUser() user: AuthUser, @Body() dto: SendConfirmDto) {
    return this.payments.confirmSend(user.id, dto.sendId, dto.to, dto.signature);
  }

  // ---------- local currency (Onramper) ----------

  /** Signed, single-use link to buy USDC into your own wallet, or sell it to your bank. */
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('onramp')
  @HttpCode(200)
  onramp(@CurrentUser() user: AuthUser, @Body() dto: OnrampDto) {
    return this.payments.onrampLink(user.id, dto.mode, dto.fiat, dto.amount);
  }

  /** After the LocalRamp pop-up closes: asks LocalRamp where that payment is and records it. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('onramp/:reference/check')
  @HttpCode(200)
  checkOnramp(@CurrentUser() user: AuthUser, @Param('reference') reference: string) {
    return this.onrampEvents.checkLocalRamp(user.id, reference);
  }
}
