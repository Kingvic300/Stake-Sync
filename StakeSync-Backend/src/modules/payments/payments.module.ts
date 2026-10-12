import { Module } from '@nestjs/common';
import { ChallengesModule } from '../challenges/challenges.module.js';
import { ChainWorkerService } from './chain-worker.service.js';
import { IndexerService } from './indexer.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { LocalRampService } from './localramp.service.js';
import { OnrampWebhookController } from './onramp-webhook.controller.js';
import { OnrampWebhookService } from './onramp-webhook.service.js';
import { OnrampService } from './onramp.service.js';

@Module({
  imports: [ChallengesModule],
  controllers: [PaymentsController, OnrampWebhookController],
  providers: [PaymentsService, ChainWorkerService, IndexerService, OnrampService, OnrampWebhookService, LocalRampService],
  exports: [PaymentsService, ChainWorkerService],
})
export class PaymentsModule {}
