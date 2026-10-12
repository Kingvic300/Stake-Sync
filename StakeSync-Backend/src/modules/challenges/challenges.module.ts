import { Module } from '@nestjs/common';
import { ChallengesController } from './challenges.controller.js';
import { ChallengesService } from './challenges.service.js';
import { LifecycleService } from './lifecycle.service.js';
import { ParticipationService } from './participation.service.js';

@Module({
  controllers: [ChallengesController],
  providers: [ChallengesService, ParticipationService, LifecycleService],
  exports: [ChallengesService, ParticipationService],
})
export class ChallengesModule {}
