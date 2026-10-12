import { Module } from '@nestjs/common';
import { ChallengesModule } from '../challenges/challenges.module.js';
import { CommunityModule } from '../community/community.module.js';
import { DisputesModule } from '../disputes/disputes.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { AdminController, PlatformController } from './admin.controller.js';
import { AdminLogsService } from './admin-logs.service.js';
import { AdminService } from './admin.service.js';
import { ApprovalsService } from './approvals.service.js';

@Module({
  imports: [ChallengesModule, CommunityModule, DisputesModule, OrganizationsModule],
  controllers: [AdminController, PlatformController],
  providers: [AdminService, ApprovalsService, AdminLogsService],
})
export class AdminModule {}
