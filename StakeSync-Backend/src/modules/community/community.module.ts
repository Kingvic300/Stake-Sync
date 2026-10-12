import { Module } from '@nestjs/common';
import { ChallengesModule } from '../challenges/challenges.module.js';
import { CommunityController } from './community.controller.js';
import { CommunityGateway } from './community.gateway.js';
import { CommunityService } from './community.service.js';

@Module({
  imports: [ChallengesModule],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityGateway],
  exports: [CommunityService],
})
export class CommunityModule {}
