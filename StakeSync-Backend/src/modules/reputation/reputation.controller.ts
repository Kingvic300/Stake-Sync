import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, OptionalAuth, type AuthUser } from '../../common/auth.js';
import { ReputationService } from './reputation.service.js';

@Controller()
export class ReputationController {
  constructor(private readonly reputation: ReputationService) {}

  @OptionalAuth()
  @Get('leaderboards/people')
  people(@CurrentUser() user?: AuthUser) {
    return this.reputation.people(user?.id);
  }

  @OptionalAuth()
  @Get('leaderboards/orgs')
  orgs() {
    return this.reputation.organizations();
  }

  @Get('me/score')
  score(@CurrentUser() user: AuthUser) {
    return this.reputation.breakdown(user.id);
  }

  @OptionalAuth()
  @Get('users/:handle/achievements')
  achievements(@Param('handle') handle: string) {
    return this.reputation.achievementsFor(handle);
  }
}
