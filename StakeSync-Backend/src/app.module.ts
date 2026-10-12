import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { AppThrottlerGuard } from './common/guards/throttler.guard.js';
import configuration from './config/configuration.js';
import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChallengesModule } from './modules/challenges/challenges.module.js';
import { CommunityModule } from './modules/community/community.module.js';
import { DisputesModule } from './modules/disputes/disputes.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { SolanaModule } from './modules/payments/solana/solana.module.js';
import { ReputationModule } from './modules/reputation/reputation.module.js';
import { RiskModule } from './modules/risk/risk.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Default: 120 requests a minute per client; sensitive routes set tighter limits (PRD §30).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    CoreModule,
    SolanaModule,
    NotificationsModule,
    RiskModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ChallengesModule,
    VerificationModule,
    PaymentsModule,
    CommunityModule,
    DisputesModule,
    ReputationModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
