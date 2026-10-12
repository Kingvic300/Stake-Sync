import { Global, Module } from '@nestjs/common';
import { RiskService } from './risk.service.js';

/** Risk endpoints live in the admin module; the service is used across the app. */
@Global()
@Module({
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
