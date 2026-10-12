import { Injectable } from '@nestjs/common';
import { PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { ProviderUnavailable } from '../../../common/http.js';
import { SolanaService } from '../../payments/solana/solana.service.js';
import { plural, type AdapterContext, type CountResult, type DayResult, type VerificationAdapter } from './adapter.js';

const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const LOADER_V4 = 'LoaderV411111111111111111111111111111111111';

interface Found {
  signature: string;
  at: Date;
  programs: string[];
}

/** On-chain activity from the person's linked wallet: transactions, program interactions, deployments (PRD §9). */
@Injectable()
export class SolanaAdapter implements VerificationAdapter {
  readonly key = 'solana' as const;

  constructor(private readonly solana: SolanaService) {}

  private async activity(ctx: AdapterContext, activity: 'deploy' | 'transaction' | 'program', programId?: string): Promise<Found[]> {
    const cfg = ctx.challenge.verificationConfig.solana ?? { cluster: 'devnet', activity: 'transaction' };
    const conn = cfg.cluster === 'mainnet-beta' ? this.solana.connection : this.solana.devnet;
    const wallet = new PublicKey(ctx.wallet!);
    const fromSec = ctx.from.getTime() / 1000;
    const toSec = ctx.to.getTime() / 1000;
    const out: Found[] = [];
    let before: string | undefined;
    try {
      for (let page = 0; page < 5; page++) {
        const sigs = await conn.getSignaturesForAddress(wallet, { before, limit: 200 });
        if (!sigs.length) break;
        for (const s of sigs) {
          if (!s.blockTime || s.err) continue;
          if (s.blockTime >= toSec) continue;
          if (s.blockTime < fromSec) return out;
          if (activity === 'transaction') {
            out.push({ signature: s.signature, at: new Date(s.blockTime * 1000), programs: [] });
            continue;
          }
          const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
          if (!tx) continue;
          const hit = activity === 'deploy' ? this.deployedPrograms(tx, ctx.wallet!) : this.touches(tx, programId!) ? [programId!] : [];
          if (hit.length) out.push({ signature: s.signature, at: new Date(s.blockTime * 1000), programs: hit });
        }
        before = sigs[sigs.length - 1].signature;
        if (sigs.length < 200) break;
      }
    } catch (e) {
      throw new ProviderUnavailable('solana', e instanceof Error ? e.message : 'rpc error');
    }
    return out;
  }

  /** Program deploys and upgrades signed with this wallet as the upgrade authority. */
  private deployedPrograms(tx: ParsedTransactionWithMeta, wallet: string) {
    const out: string[] = [];
    for (const ix of tx.transaction.message.instructions) {
      const pid = ix.programId.toBase58();
      if (pid !== UPGRADEABLE_LOADER && pid !== LOADER_V4) continue;
      const parsed = (ix as { parsed?: { type?: string; info?: Record<string, string> } }).parsed;
      const type = parsed?.type ?? '';
      if (!/deploy|upgrade/i.test(type) && pid === UPGRADEABLE_LOADER) continue;
      const info = parsed?.info ?? {};
      if ((info.authority ?? info.upgradeAuthority ?? info.payerAccount) && ![info.authority, info.upgradeAuthority, info.payerAccount].includes(wallet)) continue;
      out.push(info.programAccount ?? info.programId ?? info.program ?? pid);
    }
    return out;
  }

  private touches(tx: ParsedTransactionWithMeta, programId: string) {
    return tx.transaction.message.accountKeys.some((k) => k.pubkey.toBase58() === programId);
  }

  async day(ctx: AdapterContext): Promise<DayResult> {
    const cfg = ctx.challenge.verificationConfig.solana ?? { cluster: 'devnet' as const, activity: 'transaction' as const };
    const found = await this.activity(ctx, cfg.activity, cfg.programId);
    const network = cfg.cluster === 'mainnet-beta' ? 'mainnet' : 'devnet';
    if (found.length) {
      const what = cfg.activity === 'deploy' ? plural(found.length, 'program deployment') : cfg.activity === 'program' ? plural(found.length, 'program interaction') : plural(found.length, 'transaction');
      return {
        outcome: 'verified',
        detail: `${what} on ${network}`,
        evidence: { signatures: found.slice(0, 20) },
        fingerprints: found.map((f) => `sol:${f.signature}`).concat(found.flatMap((f) => f.programs.map((p) => `solprog:${p}`))),
        units: found.length,
      };
    }
    return { outcome: 'failed', detail: `No qualifying ${cfg.activity === 'deploy' ? 'deployments' : 'activity'} on ${network} from ${ctx.wallet!.slice(0, 4)}…${ctx.wallet!.slice(-4)}`, evidence: { wallet: ctx.wallet } };
  }

  async count(ctx: AdapterContext): Promise<CountResult> {
    const cfg = ctx.challenge.verificationConfig.solana ?? { cluster: 'devnet' as const, activity: 'deploy' as const };
    const found = await this.activity(ctx, cfg.activity, cfg.programId);
    // A deployment challenge counts distinct programs, so upgrading the same one repeatedly doesn't add up.
    const total = cfg.activity === 'deploy' ? new Set(found.flatMap((f) => f.programs)).size : found.length;
    return {
      total,
      detail: cfg.activity === 'deploy' ? plural(total, 'new program') + ' deployed' : plural(total, 'transaction'),
      evidence: { signatures: found.slice(0, 50) },
      fingerprints: found.flatMap((f) => f.programs.map((p) => `solprog:${p}`)),
    };
  }
}
