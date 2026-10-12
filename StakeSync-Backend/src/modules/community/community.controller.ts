import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser, OptionalAuth, type AuthUser } from '../../common/auth.js';
import { CommunityService } from './community.service.js';

class PostDto {
  @IsString()
  @Length(1, 2000)
  body: string;

  @IsOptional()
  @IsUUID()
  replyTo?: string;

  @IsOptional()
  @IsBoolean()
  announcement?: boolean;
}

class EditDto {
  @IsString()
  @Length(1, 2000)
  body: string;
}

class ReactDto {
  @IsString()
  @MaxLength(16)
  emoji: string;
}

class PinDto {
  @IsBoolean()
  pinned: boolean;
}

class ReportDto {
  @IsIn(['message', 'account', 'challenge'])
  kind: 'message' | 'account' | 'challenge';

  /** Message id, account handle or challenge id. */
  @IsString()
  @MaxLength(80)
  targetId: string;

  @IsIn(['Spam or scam', 'Harassment', 'Encouraging cheating', 'Off topic', 'Inappropriate', 'Fake proof', 'Other'])
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  detail?: string;
}

class MuteDto {
  @IsString()
  handle: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  hours?: number;

  @IsString()
  @Length(3, 500)
  reason: string;
}

class ShareDto {
  @IsString()
  @Length(2, 240)
  text: string;
}

@Controller()
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('challenges/:id/messages')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('before') before?: string) {
    return this.community.list(id, user.id, before);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('challenges/:id/messages')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PostDto) {
    return this.community.post(id, user.id, dto.body, dto.replyTo, dto.announcement ?? false);
  }

  @Patch('messages/:messageId')
  edit(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: EditDto) {
    return this.community.edit(user.id, messageId, dto.body);
  }

  @Delete('messages/:messageId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string) {
    return this.community.remove(user.id, messageId);
  }

  @Post('messages/:messageId/pin')
  @HttpCode(204)
  pin(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: PinDto) {
    return this.community.pin(user.id, messageId, dto.pinned);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('messages/:messageId/reactions')
  react(@CurrentUser() user: AuthUser, @Param('messageId', ParseUUIDPipe) messageId: string, @Body() dto: ReactDto) {
    return this.community.react(user.id, messageId, dto.emoji);
  }

  @Post('challenges/:id/mutes')
  @HttpCode(204)
  mute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MuteDto) {
    return this.community.mute(user.id, id, dto.handle, dto.hours ?? null, dto.reason);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('reports')
  report(@CurrentUser() user: AuthUser, @Body() dto: ReportDto) {
    return this.community.report(user.id, dto);
  }

  @OptionalAuth()
  @Get('challenges/:id/feed')
  feed(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.community.feedFor(id, user?.id);
  }

  @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  @Post('challenges/:id/feed')
  share(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ShareDto) {
    return this.community.share(user.id, id, dto.text);
  }
}
