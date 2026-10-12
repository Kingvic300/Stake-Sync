// One-time setup of the escrow program: records the verifier key, the treasury wallet and the fees.
// Run after deploying the program:  node --env-file=.env scripts/init-config.mjs
// The signer must be the program's upgrade authority (here PLATFORM_SECRET_KEY, or ADMIN_SECRET_KEY if set).
// Safe to re-run: if the program is already set up, it prints the current settings and changes nothing.
import { AnchorProvider, Program, Wallet } from '@anchor-lang/core';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { readFileSync } from 'node:fs';

const env = process.env;
const cluster = env.SOLANA_CLUSTER || 'mainnet-beta';
const rpc = env.SOLANA_RPC_URL || (cluster === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');
const programId = new PublicKey(env.STAKE_SYNC_PROGRAM_ID || 'ANKCFRDYu45J199F1teNEeCiRUC7xYRArMtiHRYkvAcV');
const usdcMint = new PublicKey(
  env.USDC_MINT || (cluster === 'devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
);
const FEES = { forfeitBps: 6000, joinBps: 200 }; // 60% of forfeits to the platform, 2% joining fee

function keypair(name) {
  const raw = (env[name] || '').trim();
  if (!raw) throw new Error(`${name} is not set`);
  return Keypair.fromSecretKey(raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
}

const admin = keypair(env.ADMIN_SECRET_KEY ? 'ADMIN_SECRET_KEY' : 'PLATFORM_SECRET_KEY');
const verifier = keypair('VERIFIER_SECRET_KEY').publicKey;
if (!env.TREASURY_WALLET) throw new Error('TREASURY_WALLET is not set');
const treasury = new PublicKey(env.TREASURY_WALLET);

const idl = JSON.parse(readFileSync(new URL('../src/modules/payments/solana/stake-sync.idl.json', import.meta.url), 'utf8'));
const connection = new Connection(rpc, 'confirmed');
const program = new Program({ ...idl, address: programId.toBase58() }, new AnchorProvider(connection, new Wallet(admin), { commitment: 'confirmed' }));
const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId);
const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'));

const show = (c) => ({
  admin: c.admin.toBase58(),
  verifier: c.verifier.toBase58(),
  treasury: c.treasury.toBase58(),
  usdcMint: c.usdcMint.toBase58(),
  forfeitSharePercent: c.feeBps / 100,
  joiningFeePercent: c.joinFeeBps / 100,
  paused: c.paused,
});

console.log(`Cluster ${cluster}, program ${programId.toBase58()}, config ${config.toBase58()}`);
const existing = await program.account.config.fetchNullable(config);
if (existing) {
  console.log('Already set up; nothing changed:', show(existing));
  const mismatches = [
    !existing.verifier.equals(verifier) && 'verifier',
    !existing.treasury.equals(treasury) && 'treasury',
    !existing.usdcMint.equals(usdcMint) && 'USDC mint',
  ].filter(Boolean);
  if (mismatches.length) console.log(`Differs from .env: ${mismatches.join(', ')}. Change it with update_config, signed by the config admin.`);
  process.exit(0);
}

const signature = await program.methods
  .initializeConfig(verifier, treasury, FEES)
  .accountsPartial({ admin: admin.publicKey, config, usdcMint, program: programId, programData, systemProgram: SystemProgram.programId })
  .signers([admin])
  .rpc();
console.log('Set up. Transaction:', signature);
console.log(show(await program.account.config.fetch(config)));
process.exit(0); // the RPC connection would otherwise keep the script running
