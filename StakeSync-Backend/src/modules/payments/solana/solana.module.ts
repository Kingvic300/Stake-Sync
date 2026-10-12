import { Global, Module } from '@nestjs/common';
import { RentService } from './rent.service.js';
import { SolanaService } from './solana.service.js';

@Global()
@Module({
  providers: [SolanaService, RentService],
  exports: [SolanaService, RentService],
})
export class SolanaModule {}
