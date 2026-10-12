import { PublicKey } from '@solana/web3.js';
import { SEEDS } from './stake-sync.constants.js';

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

/** PDA derivations, mirroring the program's seeds. */
export class Pdas {
  constructor(readonly programId: PublicKey) {}

  private find(...seeds: Buffer[]) {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }

  config() {
    return this.find(Buffer.from(SEEDS.config));
  }
  challenge(creator: PublicKey, id: bigint) {
    return this.find(Buffer.from(SEEDS.challenge), creator.toBuffer(), u64le(id));
  }
  vault(challenge: PublicKey) {
    return this.find(Buffer.from(SEEDS.vault), challenge.toBuffer());
  }
  participant(challenge: PublicKey, user: PublicKey) {
    return this.find(Buffer.from(SEEDS.participant), challenge.toBuffer(), user.toBuffer());
  }
  sponsorship(challenge: PublicKey, sponsor: PublicKey) {
    return this.find(Buffer.from(SEEDS.sponsor), challenge.toBuffer(), sponsor.toBuffer());
  }
}
