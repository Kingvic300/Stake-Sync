import { Module } from '@nestjs/common';
import { DataExportService } from './data-export.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, DataExportService],
  exports: [UsersService],
})
export class UsersModule {}
