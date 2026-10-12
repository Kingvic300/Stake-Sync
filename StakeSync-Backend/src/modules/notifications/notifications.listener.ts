import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Events,
  type ChallengeEvent,
  type DisputeEvent,
  type MessageEvent,
  type MoneyEvent,
  type ParticipantEvent,
  type PeriodDecidedEvent,
  type UserEvent,
} from '../../common/events.js';
import { toUsd } from '../../common/money.js';
import { penalty } from '../../common/settlement-math.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { Dispute } from '../disputes/entities/dispute.entity.js';
import { User } from '../users/entities/user.entities.js';
import { Verification } from '../verification/entities/verification.entities.js';
import { MailService } from './mail.service.js';
import { NotificationsService } from './notifications.service.js';

const usd = (units: bigint) => `$${toUsd(units).toFixed(2).replace(/\.00$/, '')}`;

/**
 * Turns what happens into notifications (PRD §25): money and problems are always sent; routine
 * progress is in-app only so it doesn't become spam.
 */
@Injectable()
export class NotificationsListener {
  constructor(
    private readonly notifications: NotificationsService,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Verification) private readonly verifications: Repository<Verification>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
  ) {}

  /** Welcome email for every new account, whichever way they signed up. */
  @OnEvent(Events.UserSignedUp, { async: true })
  async welcome(e: UserEvent) {
    const u = await this.users.findOneBy({ id: e.userId });
    if (!u?.email) return;
    await this.mail.send(
      u.email,
      'Welcome to Stake-Sync',
      `Hi ${u.name.split(' ')[0] || 'there'}, welcome to Stake-Sync.\n\nHere's how it works: pick a challenge, read its rules, and join. Your progress is checked automatically from the accounts you link, like GitHub or LeetCode. Finish and you get your stake back plus a share of the rewards.\n\nStart with a challenge that's open now, or create your own and invite friends.`,
      { label: 'Find a challenge', href: '/explore' },
    );
  }

  /** Confirms a join by email, with the rules that now apply. */
  @OnEvent(Events.ParticipantJoined, { async: true })
  async joined(e: ParticipantEvent) {
    const [c, p] = await Promise.all([this.challenges.findOneBy({ id: e.challengeId }), this.participants.findOneBy({ id: e.participantId })]);
    if (!c || !p) return;
    const starts = c.startsAt.toUTCString().slice(0, 16);
    await this.notifications.notify(p.userId, {
      kind: 'activity',
      title: `You're in ${c.title}`,
      body: `It starts ${starts}. Each day: ${c.requirement}. ${c.freeStrikes ? `You have ${c.freeStrikes} free strikes.` : ''}${p.stake > 0n ? ` Your ${usd(p.stake)} stake is held in escrow until it ends.` : ''}`.trim(),
      href: `/c/${c.slug}`,
      email: true,
      emailAction: 'Open the challenge',
      dedupeKey: `joined:${p.id}`,
    });
  }

  @OnEvent(Events.PeriodDecided, { async: true })
  async period(e: PeriodDecidedEvent) {
    const [c, p] = await Promise.all([this.challenges.findOneBy({ id: e.challengeId }), this.participants.findOneBy({ id: e.participantId })]);
    if (!c || !p) return;
    const v = await this.verifications.findOneBy({ id: e.verificationId });
    const day = c.mode === 'days' ? `Day ${e.period + 1}` : 'Your final total';
    const href = `/c/${c.slug}`;
    const key = `period:${e.verificationId}:${e.state}`;
    if (e.state === 'verified') {
      return this.notifications.notify(p.userId, { kind: 'verified', title: `${day} verified`, body: `${c.title}. ${v?.detail ?? ''}`.trim(), href, dedupeKey: key, quiet: true });
    }
    if (e.state === 'excused') {
      return this.notifications.notify(p.userId, {
        kind: 'activity',
        title: `${day} couldn't be checked`,
        body: `${c.title}. ${v?.detail ?? 'The provider was unavailable'}. It won't count against you.`,
        href,
        dedupeKey: key,
        quiet: true,
      });
    }
    // A miss: strike, penalty warning, or out of the challenge. Described by its position, so
    // several misses decided together still read 1st, 2nd, 3rd.
    const allowed = c.periodCount - c.requiredPeriods;
    const ladder = c.penaltiesBps.map((b) => b / 100);
    const nth = await this.verifications
      .createQueryBuilder('v')
      .where("v.participant_id = :pid AND v.state IN ('failed', 'disputed') AND v.period <= :period", { pid: p.id, period: e.period })
      .getCount();
    if (c.mode === 'days' && c.stakeMode === 'none' && nth > allowed) {
      if (nth > allowed + 1) return; // already told them
      return this.notifications.notify(p.userId, {
        kind: 'penalty',
        title: `You're out of ${c.title}`,
        body: `${c.title}. You missed day ${e.period + 1} with no strikes left, so you're out and we've stopped checking your days. If our check was wrong, dispute it and you'll be back in.`,
        href: '/disputes',
        dedupeKey: `out:${p.id}`,
        email: true,
      });
    }
    if (c.mode === 'count' || nth > allowed) {
      if (c.mode === 'days' && nth > allowed + 1) return; // already told them
      return this.notifications.notify(p.userId, {
        kind: 'penalty',
        title: c.mode === 'count' ? `You didn't reach the target in ${c.title}` : `Too many missed days in ${c.title}`,
        body: `${v?.detail ?? ''}. If our check was wrong, you can dispute it before the challenge settles.`.replace(/^\. /, ''),
        href: '/disputes',
        dedupeKey: `out:${p.id}`,
        email: true,
      });
    }
    if (nth <= c.freeStrikes) {
      const left = c.freeStrikes - nth;
      return this.notifications.notify(p.userId, {
        kind: 'strike',
        title: `You used a strike on day ${e.period + 1}`,
        body: `${c.title}. ${left ? `${left} strike${left === 1 ? '' : 's'} left${c.stakeMode === 'none' ? '' : ' before penalties start'}.` : c.stakeMode === 'none' ? 'No strikes left: the next miss takes you out.' : 'No strikes left: the next miss costs part of your stake.'} Wrong? Dispute it.`,
        href,
        dedupeKey: key,
      });
    }
    const now = penalty(p.stake, nth, c.freeStrikes, ladder);
    const before = penalty(p.stake, nth - 1, c.freeStrikes, ladder);
    return this.notifications.notify(p.userId, {
      kind: 'penalty',
      title: `Day ${e.period + 1} missed: ${usd(now - before)} penalty`,
      body: `${c.title}. Total penalty so far ${usd(now)} of your ${usd(p.stake)} stake. ${allowed - nth} more miss${allowed - nth === 1 ? '' : 'es'} allowed. Wrong? Dispute it.`,
      href,
      dedupeKey: key,
      email: true,
    });
  }

  @OnEvent(Events.ParticipantSettled, { async: true })
  async settled(e: ParticipantEvent) {
    const [c, p] = await Promise.all([this.challenges.findOneBy({ id: e.challengeId }), this.participants.findOneBy({ id: e.participantId })]);
    if (!c || !p) return;
    if (p.completed) {
      await this.notifications.notify(p.userId, {
        kind: 'completed',
        title: `You completed ${c.title}`,
        body: 'It’s on your profile as a verified achievement. If you staked, your money and any reward are ready to claim in your wallet.',
        href: '/wallet#claims',
        email: true,
        emailAction: 'Claim your money',
        dedupeKey: `completed:${p.id}`,
      });
    } else {
      await this.notifications.notify(p.userId, {
        kind: 'activity',
        title: `${c.title} has ended`,
        body: p.stake > 0n ? `You didn't complete it this time, so your ${usd(p.stake)} stake was forfeited under the rules. Missed days you think were wrong can still be disputed until the window closes.` : "You didn't complete it this time. There's always the next one.",
        href: `/c/${c.slug}`,
        email: true,
        emailAction: 'See your results',
        dedupeKey: `settled:${p.id}`,
      });
    }
  }

  @OnEvent(Events.ChallengeFinalized, { async: true })
  async finalized(e: ChallengeEvent) {
    const ps = await this.participants.findBy({ challengeId: e.challengeId, completed: true, claimed: false });
    const c = await this.challenges.findOneBy({ id: e.challengeId });
    if (!c) return;
    for (const p of ps) {
      if (p.claimable <= 0n) continue;
      await this.notifications.notify(p.userId, {
        kind: 'reward',
        title: `${usd(p.claimable)} ready to claim`,
        body: `${c.title} settled. Your stake${c.rewardPerFinisher ? ' plus your share of the rewards' : ''}.`,
        href: '/wallet',
        dedupeKey: `claimable:${p.id}`,
        email: true,
        emailAction: 'Claim now',
      });
    }
  }

  @OnEvent(Events.Claimed, { async: true })
  async claimed(e: MoneyEvent) {
    const c = e.challengeId ? await this.challenges.findOneBy({ id: e.challengeId }) : null;
    await this.notifications.notify(e.userId, {
      kind: 'reward',
      title: c?.status === 'cancelled' ? `${usd(e.amount)} refunded` : `${usd(e.amount)} claimed`,
      body: `${c?.title ?? 'Your challenge'}. It’s in your wallet now.`,
      href: '/wallet',
      dedupeKey: `claimed:${e.signature ?? `${e.userId}:${e.challengeId}`}`,
    });
  }

  @OnEvent(Events.Sponsored, { async: true })
  async sponsored(e: MoneyEvent) {
    const c = e.challengeId ? await this.challenges.findOneBy({ id: e.challengeId }) : null;
    if (!c) return;
    await this.notifications.notify(e.userId, { kind: 'activity', title: `You sponsored ${c.title}`, body: `${usd(e.amount)} added to the reward pool. Thank you!`, href: `/c/${c.slug}`, dedupeKey: `sponsor:${e.signature}` });
    if (c.creatorId !== e.userId) {
      const sponsor = await this.users.findOneBy({ id: e.userId });
      await this.notifications.notify(c.creatorId, { kind: 'activity', title: `New sponsor for ${c.title}`, body: `${sponsor?.name ?? 'Someone'} added ${usd(e.amount)} to the reward pool.`, href: `/c/${c.slug}`, dedupeKey: `sponsored:${e.signature}` });
    }
  }

  @OnEvent(Events.ChallengeCreated, { async: true })
  async created(e: ChallengeEvent) {
    const c = await this.challenges.findOneBy({ id: e.challengeId });
    if (!c) return;
    await this.notifications.notify(c.creatorId, {
      kind: 'activity',
      title: `${c.title} is ready`,
      body: c.privacy === 'private' ? `It's private: only people with your link or invite code ${c.inviteCode} can join. Share it to bring people in.` : `It's open for people to join. Share invite code ${c.inviteCode} or the link to bring friends in.`,
      href: `/c/${c.slug}`,
      email: true,
      emailAction: 'Open your challenge',
      dedupeKey: `created:${c.id}`,
    });
  }

  @OnEvent(Events.DisputeOpened, { async: true })
  async disputeOpened(e: DisputeEvent) {
    const d = await this.disputes.findOneBy({ id: e.disputeId });
    if (!d) return;
    await this.notifications.notify(e.userId, {
      kind: 'dispute',
      title: `Dispute received for day ${d.period + 1}`,
      body: `A moderator will review it by ${d.dueAt.toUTCString().slice(0, 22)} UTC. ${usd(d.lockedAmount)} stays locked until then.`,
      href: '/disputes',
      dedupeKey: `dispute-open:${d.id}`,
    });
  }

  @OnEvent(Events.DisputeUpdated, { async: true })
  async disputeUpdated(e: DisputeEvent) {
    const d = await this.disputes.findOneBy({ id: e.disputeId });
    if (!d) return;
    const c = await this.challenges.findOneByOrFail({ id: d.challengeId });
    const msg = {
      waiting_on_user: { title: 'Your dispute needs more evidence', body: `${c.title}, day ${d.period + 1}. ${d.timeline[d.timeline.length - 1]?.text.replace('Asked for more evidence: ', '') ?? ''}` },
      approved: { title: `Day ${d.period + 1} now counts`, body: `${c.title}. Your dispute was approved: ${d.decisionReason ?? ''}` },
      failure_confirmed: { title: `Day ${d.period + 1} stays missed`, body: `${c.title}. ${d.decisionReason ?? ''} Reply to our email if you have new evidence.` },
    } as const;
    const m = msg[d.status as keyof typeof msg];
    if (!m) return;
    await this.notifications.notify(e.userId, { kind: 'dispute', title: m.title, body: m.body, href: '/disputes', dedupeKey: `dispute:${d.id}:${d.status}:${d.timeline.length}`, email: true });
  }

  @OnEvent('verification.proof_reviewed', { async: true })
  async proofReviewed(e: { proofId: string; userId: string; challengeId: string; approved: boolean; reason: string }) {
    if (e.approved) return; // the verified-day notification follows
    const c = await this.challenges.findOneBy({ id: e.challengeId });
    await this.notifications.notify(e.userId, {
      kind: 'problem',
      title: 'Your proof wasn’t approved',
      body: `${c?.title ?? ''}. ${e.reason} You can submit another today, or dispute the day if you think this is wrong.`,
      href: c ? `/c/${c.slug}` : '/dashboard',
      dedupeKey: `proof:${e.proofId}`,
    });
  }

  @OnEvent(Events.MessagePosted, { async: true })
  async message(e: MessageEvent) {
    const [c, author] = await Promise.all([this.challenges.findOneBy({ id: e.challengeId }), this.users.findOneBy({ id: e.authorId })]);
    if (!c || !author) return;
    const first = author.name.split(' ')[0];
    const href = `/c/${c.slug}`;
    for (const id of e.mentions) {
      await this.notifications.notify(id, { kind: 'message', title: `${first} mentioned you`, body: c.title, href, dedupeKey: `mention:${e.messageId}:${id}`, quiet: true });
    }
    if (e.replyToAuthorId && e.replyToAuthorId !== e.authorId && !e.mentions.includes(e.replyToAuthorId)) {
      await this.notifications.notify(e.replyToAuthorId, { kind: 'message', title: `${first} replied to you`, body: c.title, href, dedupeKey: `reply:${e.messageId}`, quiet: true });
    }
  }
}
