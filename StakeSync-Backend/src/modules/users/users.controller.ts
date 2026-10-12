import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseFilePipeBuilder, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser, OptionalAuth, type AuthUser } from '../../common/auth.js';
import { AppError, notFound } from '../../common/errors.js';
import { DataExportService } from './data-export.service.js';
import type { ConnectionProvider } from './entities/user.entities.js';
import { UsersService } from './users.service.js';

class PrivacyDto {
  @IsOptional()
  @IsIn(['public', 'members', 'private'])
  profile?: 'public' | 'members' | 'private';

  @IsOptional()
  @IsBoolean()
  showOnLeaderboards?: boolean;

  @IsOptional()
  @IsBoolean()
  showConnectedAccounts?: boolean;
}

class NotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  muted?: string[];
}

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  handle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PrivacyDto)
  privacy?: PrivacyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationPrefsDto)
  notificationPrefs?: NotificationPrefsDto;

  @IsOptional()
  @IsIn(['wallet', 'local'])
  fundingPreference?: 'wallet' | 'local';

  @IsOptional()
  @IsBoolean()
  onboarded?: boolean;

  /** Accept the current Terms of Service and Privacy Policy (shown again when they change). */
  @IsOptional()
  @IsBoolean()
  acceptTerms?: boolean;
}

class UsernameDto {
  @IsString()
  @Length(2, 40)
  username: string;
}

const image = new ParseFilePipeBuilder()
  .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp|heic)$/ })
  .addMaxSizeValidator({ maxSize: 8 * 1024 * 1024 })
  .build();

@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly exports: DataExportService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  /** Download everything we keep about you, as a JSON file. Once an hour. */
  @Get('me/export')
  @Header('Cache-Control', 'no-store')
  async export(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    try {
      const { json, filename } = await this.exports.export(user.id);
      return new StreamableFile(Buffer.from(json, 'utf8'), { type: 'application/json; charset=utf-8', disposition: `attachment; filename="${filename}"` });
    } catch (e) {
      if (e instanceof AppError && e.code === 'export_rate_limited') res.setHeader('Retry-After', String(Number(e.details?.retryAfter) || 3600));
      throw e;
    }
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.update(user.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  avatar(@CurrentUser() user: AuthUser, @UploadedFile(image) file: Express.Multer.File) {
    return this.users.setAvatar(user.id, file.buffer);
  }

  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.users.removeAvatar(user.id);
  }

  /** Close the account. Explains plainly what (if anything) has to happen first. */
  @Delete('me')
  close(@CurrentUser() user: AuthUser) {
    return this.users.closeAccount(user.id);
  }

  @Delete('me/connections/:provider')
  @HttpCode(204)
  disconnect(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    if (!['github', 'google', 'leetcode', 'codeforces', 'wakatime'].includes(provider)) throw notFound('connection');
    return this.users.disconnect(user.id, provider as ConnectionProvider);
  }

  /** LeetCode/Codeforces: get a code to put on the public profile. */
  @Post('me/connections/:provider/code')
  @HttpCode(200)
  code(@CurrentUser() user: AuthUser, @Param('provider') provider: string, @Body() dto: UsernameDto) {
    return this.users.profileCode(user.id, this.codeProvider(provider), dto.username);
  }

  @Post('me/connections/:provider/verify')
  @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    return this.users.verifyProfileCode(user.id, this.codeProvider(provider));
  }

  @Post('me/wallets/:address/primary')
  @HttpCode(204)
  primary(@CurrentUser() user: AuthUser, @Param('address') address: string) {
    return this.users.setPrimaryWallet(user.id, address);
  }

  @Delete('me/wallets/:address')
  @HttpCode(204)
  unlink(@CurrentUser() user: AuthUser, @Param('address') address: string) {
    return this.users.unlinkWallet(user.id, address);
  }

  @Get('users/search')
  search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    return this.users.search(user.id, String(q).slice(0, 40));
  }

  @OptionalAuth()
  @Get('users/:handle')
  profile(@Param('handle') handle: string, @CurrentUser() user?: AuthUser) {
    return this.users.profile(handle, user?.id);
  }

  private codeProvider(p: string) {
    if (p !== 'leetcode' && p !== 'codeforces') throw notFound('connection');
    return p;
  }
}
