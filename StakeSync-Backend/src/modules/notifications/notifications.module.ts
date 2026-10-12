import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';
import { PushService } from './push.service.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, MailService, PushService, NotificationsListener],
  exports: [NotificationsService, MailService],
})
export class NotificationsModule {}
