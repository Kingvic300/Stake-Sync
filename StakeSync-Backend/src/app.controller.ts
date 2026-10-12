import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './common/auth.js';
import { SolanaService } from './modules/payments/solana/solana.service.js';

@Controller()
export class AppController {
  constructor(
    private readonly db: DataSource,
    private readonly solana: SolanaService,
  ) {}

  /** Liveness and readiness for the load balancer and status page. */
  @Public()
  @Get('health')
  async health() {
    const db = await this.db
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    return { ok: db, db, cluster: this.solana.cluster, payments: this.solana.ready };
  }
}
