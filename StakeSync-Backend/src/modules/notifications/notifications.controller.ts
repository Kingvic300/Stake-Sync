import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsObject, IsString, IsUrl, IsUUID } from 'class-validator';
import { CurrentUser, Public, type AuthUser } from '../../common/auth.js';
import { NotificationsService } from './notifications.service.js';
import { PushService } from './push.service.js';

class MarkReadDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids: string[];
}

class PushSubscribeDto {
  @IsUrl({ require_tld: false })
  endpoint: string;

  @IsObject()
  keys: { p256dh: string; auth: string };
}

class PushUnsubscribeDto {
  @IsString()
  endpoint: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('before') before?: string) {
    return this.notifications.list(user.id, before);
  }

  @Post('read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.id, dto.ids);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.remove(user.id, id);
  }

  @Public()
  @Get('push/key')
  pushKey() {
    return { enabled: this.push.enabled, publicKey: this.push.publicKey ?? null };
  }

  @Post('push/subscribe')
  @HttpCode(204)
  subscribe(@CurrentUser() user: AuthUser, @Body() dto: PushSubscribeDto) {
    return this.push.subscribe(user.id, dto.endpoint, dto.keys);
  }

  @Post('push/unsubscribe')
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: PushUnsubscribeDto) {
    return this.push.unsubscribe(user.id, dto.endpoint);
  }
}
