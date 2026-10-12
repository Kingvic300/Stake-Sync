import { Module } from '@nestjs/common';
import { ReputationController } from './reputation.controller.js';
import { ReputationService } from './reputation.service.js';

@Module({
  controllers: [ReputationController],
  providers: [ReputationService],
  exports: [ReputationService],
})
export class ReputationModule {}
