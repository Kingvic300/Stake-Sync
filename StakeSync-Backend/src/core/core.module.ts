import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { CryptoService } from './crypto.service.js';
import { FilesController } from './files.controller.js';
import { LogsService } from './logs/logs.service.js';
import { SettingsService } from './settings.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  controllers: [FilesController],
  providers: [AuditService, CryptoService, SettingsService, StorageService, LogsService],
  exports: [AuditService, CryptoService, SettingsService, StorageService, LogsService],
})
export class CoreModule {}
