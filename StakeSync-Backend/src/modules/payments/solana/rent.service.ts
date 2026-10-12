import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PublicKey } from '@solana/web3.js';
import { Repository } from 'typeorm';
import { AppError, errMsg } from '../../../common/errors.js';
import { Wallet } from '../../users/entities/user.entities.js';
import { SolanaService } from './solana.service.js';

/** Rent for a participant or sponsorship account, plus headroom. */
const MIN_LAMPORTS = 2_000_000;

/**
 * Joining or sponsoring creates a small on-chain account, and its rent comes from the person's
 * wallet. People with an embedded wallet usually hold only USDC, so the platform sends just enough
 * SOL first. It's capped per wallet per day so the top-ups can't be farmed.
 */
@Injectable()
export class RentService {
  private readonly log = new Logger('Rent');
  private readonly drip: number;
  private readonly perDay: number;

  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly solana: SolanaService,
    config: ConfigService,
  ) {
    this.drip = config.get<number>('solana.rentDripLamports') ?? 3_000_000;
    this.perDay = config.get<number>('solana.rentDripsPerDay') ?? 3;
  }

  async ensure(wallet: Wallet) {
    const balance = await this.solana.solBalance(new PublicKey(wallet.address));
    if (balance >= MIN_LAMPORTS) return;
    const today = new Date().toISOString().slice(0, 10);
    const used = wallet.rentDripDay === today ? wallet.rentDripsToday : 0;
    if (used >= this.perDay) {
      throw new AppError('rent_limit', 'You’ve joined a lot today. Add a little SOL to your wallet (about 0.002) or try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      await this.solana.dripSol(new PublicKey(wallet.address), this.drip);
    } catch (e) {
      this.log.error(`Rent top-up for ${wallet.address} failed: ${errMsg(e)}`);
      throw new AppError('rent_unavailable', 'We couldn’t prepare your wallet just now. Nothing was charged. Please try again in a minute.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    await this.wallets.update({ id: wallet.id }, { rentDripDay: today, rentDripsToday: used + 1 });
  }
}
