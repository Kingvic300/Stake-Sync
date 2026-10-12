import { Module } from '@nestjs/common';
import { ChallengesModule } from '../challenges/challenges.module.js';
import { DisputesController } from './disputes.controller.js';
import { DisputesService } from './disputes.service.js';

@Module({
  imports: [ChallengesModule],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
