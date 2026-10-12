import { Global, Module } from '@nestjs/common';
import { CodeforcesAdapter } from './adapters/codeforces.adapter.js';
import { GithubAdapter } from './adapters/github.adapter.js';
import { LeetcodeAdapter } from './adapters/leetcode.adapter.js';
import { CameraAdapter, HealthAdapter, PhotoAdapter } from './adapters/proof.adapters.js';
import { SolanaAdapter } from './adapters/solana.adapter.js';
import { WakatimeAdapter } from './adapters/wakatime.adapter.js';
import { ProofsService } from './proofs.service.js';
import { ProviderHealthService } from './provider-health.service.js';
import { VerificationController } from './verification.controller.js';
import { VerificationService } from './verification.service.js';

@Global()
@Module({
  controllers: [VerificationController],
  providers: [
    VerificationService,
    ProofsService,
    ProviderHealthService,
    GithubAdapter,
    SolanaAdapter,
    LeetcodeAdapter,
    CodeforcesAdapter,
    WakatimeAdapter,
    CameraAdapter,
    HealthAdapter,
    PhotoAdapter,
  ],
  exports: [VerificationService, ProofsService, ProviderHealthService],
})
export class VerificationModule {}
