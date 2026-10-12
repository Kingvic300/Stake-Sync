import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Admin, AllowWithoutMfa, CurrentUser, OptionalAuth, Public, type AuthUser } from '../../common/auth.js';
import { notFound } from '../../common/errors.js';
import { AuthService, type RequestContext } from './auth.service.js';
import { WalletTokenService } from './wallet-token.service.js';
import type { OAuthProvider } from './oauth.service.js';

class SignupDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for your password.' })
  @MaxLength(200)
  password: string;

  /** The "I agree to the Terms of Service and Privacy Policy" checkbox. Must be true. */
  @IsBoolean()
  acceptTerms: boolean;
}

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

class AdminLoginDto extends LoginDto {
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;
}

class TokenDto {
  @IsString()
  @MaxLength(200)
  token: string;
}

class ResetDto extends TokenDto {
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for your password.' })
  @MaxLength(200)
  password: string;
}

class EmailDto {
  @IsEmail()
  email: string;
}

class ChangePasswordDto {
  @IsOptional()
  @IsString()
  current?: string;

  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for your password.' })
  @MaxLength(200)
  next: string;
}

class RefreshDto {
  @IsString()
  @MaxLength(200)
  refreshToken: string;
}

class OAuthCallbackDto {
  @IsString()
  @MaxLength(1000)
  code: string;

  @IsString()
  @MaxLength(200)
  state: string;
}

class WalletNonceDto {
  @IsString()
  @Length(32, 44)
  address: string;
}

class WalletLoginDto extends WalletNonceDto {
  @IsString()
  @MaxLength(64)
  nonce: string;

  @IsString()
  @MaxLength(120)
  signature: string;
}

class WalletLinkDto extends WalletLoginDto {
  /** embedded: created at sign-in by the app's embedded-wallet provider. external: a wallet app. */
  @IsOptional()
  @IsIn(['external', 'embedded'])
  kind?: 'external' | 'embedded';
}

class CodeDto {
  @Matches(/^\d{6}$/)
  code: string;
}

export function requestContext(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'], device: req.headers['x-device-id'] as string | undefined };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly walletTokens: WalletTokenService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.auth.signup(dto, requestContext(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, requestContext(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user.sessionId);
  }

  @Post('logout-all')
  @HttpCode(204)
  logoutAll(@CurrentUser() user: AuthUser) {
    return this.auth.revokeAll(user.id);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(user.id, id);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('verify-email/resend')
  @HttpCode(204)
  resend(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(204)
  forgot(@Body() dto: EmailDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  reset(@Body() dto: ResetDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('change-password')
  @HttpCode(204)
  change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.current, dto.next, user.sessionId);
  }

  /** mode=login signs in or signs up; mode=connect (signed in) links a verification account. */
  @OptionalAuth()
  @Get('oauth/:provider/start')
  start(
    @Param('provider') provider: string,
    @Query('mode') mode: 'login' | 'connect' = 'login',
    @Query('redirect') redirect: string | undefined,
    @Query('acceptTerms') acceptTerms: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.auth.oauthStart(this.provider(provider), mode === 'connect' ? 'connect' : 'login', user?.id ?? null, redirect, acceptTerms === 'true');
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('oauth/:provider/callback')
  @HttpCode(200)
  callback(@Param('provider') provider: string, @Body() dto: OAuthCallbackDto, @Req() req: Request, @CurrentUser() user?: AuthUser) {
    return this.auth.oauthCallback(this.provider(provider), dto.code, dto.state, requestContext(req), user?.id);
  }

  @Public()
  @Post('wallet/nonce')
  @HttpCode(200)
  walletNonce(@Body() dto: WalletNonceDto) {
    return this.auth.walletNonce(dto.address, 'login', null);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('wallet/login')
  @HttpCode(200)
  walletLogin(@Body() dto: WalletLoginDto, @Req() req: Request) {
    return this.auth.walletLogin(dto.nonce, dto.address, dto.signature, requestContext(req));
  }

  /** Link a wallet to the signed-in account by signing a message. */
  @Post('wallet/link/nonce')
  @HttpCode(200)
  linkNonce(@CurrentUser() user: AuthUser, @Body() dto: WalletNonceDto) {
    return this.auth.walletNonce(dto.address, 'link', user.id);
  }

  @Post('wallet/link')
  @HttpCode(200)
  link(@CurrentUser() user: AuthUser, @Body() dto: WalletLinkDto) {
    return this.auth.linkWallet(user.id, dto.nonce, dto.address, dto.signature, dto.kind);
  }

  // ---------- embedded wallets (Privy) ----------

  /** Public key Privy uses to verify wallet tokens. Register {API_URL}/api/auth/wallet-token/jwks.json in Privy. */
  @Public()
  @Get('wallet-token/jwks.json')
  walletJwks() {
    return this.walletTokens.jwks();
  }

  /** A 10-minute token proving who is signed in, for the embedded-wallet provider. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('wallet-token')
  @HttpCode(200)
  walletToken(@CurrentUser() user: AuthUser) {
    return this.walletTokens.issue(user.id);
  }

  // ---------- admin app ----------

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.auth.adminLogin(dto, requestContext(req));
  }

  @Admin()
  @AllowWithoutMfa()
  @Post('admin/2fa/setup')
  @HttpCode(200)
  totpSetup(@CurrentUser() user: AuthUser) {
    return this.auth.totpSetup(user.id);
  }

  @Admin()
  @AllowWithoutMfa()
  @Post('admin/2fa/enable')
  @HttpCode(200)
  totpEnable(@CurrentUser() user: AuthUser, @Body() dto: CodeDto) {
    return this.auth.totpEnable(user.id, dto.code, user.sessionId);
  }

  private provider(p: string): OAuthProvider {
    if (!(['google', 'github', 'wakatime'] as string[]).includes(p)) throw notFound('sign-in method');
    return p as OAuthProvider;
  }
}
