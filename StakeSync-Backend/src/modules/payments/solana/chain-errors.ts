import { HttpStatus } from '@nestjs/common';
import { AppError, unavailable } from '../../../common/errors.js';
import { programErrorCode } from './solana.service.js';
import { STAKE_SYNC_ERRORS } from './stake-sync.constants.js';

/** Plain-language messages for program errors people can hit. Everything else is generic (UX rule 5). */
const MESSAGES: Partial<Record<(typeof STAKE_SYNC_ERRORS)[keyof typeof STAKE_SYNC_ERRORS], string>> = {
  Paused: 'New challenges and joins are paused for a short maintenance window. Please try again later.',
  JoinClosed: 'Joining has closed for this challenge.',
  ChallengeFull: 'This challenge is full.',
  StakeOutOfRange: "That stake is outside this challenge's range.",
  RulesMismatch: 'The rules you accepted don’t match this challenge. Review them again to join.',
  FreezeUnavailable: 'You’ve already used your freeze, or this challenge doesn’t allow one.',
  FreezeInvalid: 'A freeze has to start today or later and can’t cover a day already marked missed.',
  DisputeWindowClosed: 'The window to dispute this day has closed.',
  AlreadyDisputed: 'This day is already under review.',
  NotDisputable: 'Only a missed day can be disputed.',
  AlreadyClaimed: 'You’ve already claimed this.',
  NothingToClaim: 'There’s nothing to claim from this challenge.',
  NotSettled: 'Payouts open once the challenge is settled. We’ll let you know.',
  TooLateToCancel: 'This challenge has started, so it can’t be cancelled.',
  CannotReclaim: 'Sponsorship can only be taken back if the challenge was cancelled or nobody finished.',
  NotOpen: 'This challenge isn’t open for that right now.',
};

/** Converts a failed chain call into something safe to show. Re-throws AppErrors unchanged. */
export function chainFailure(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = programErrorCode(e);
  const name = code !== undefined ? STAKE_SYNC_ERRORS[code as keyof typeof STAKE_SYNC_ERRORS] : undefined;
  const msg = name ? MESSAGES[name] : undefined;
  if (msg) return new AppError(`chain_${name!.toLowerCase()}`, msg, HttpStatus.CONFLICT);
  const text = e instanceof Error ? e.message : String(e);
  if (/insufficient (funds|lamports)|0x1\b/i.test(text)) {
    return new AppError('insufficient_funds', "There isn't enough in the wallet for this. Add money and try again.", HttpStatus.PAYMENT_REQUIRED);
  }
  return unavailable('The Solana network didn’t confirm this in time. Nothing was charged. Please try again in a minute.');
}
