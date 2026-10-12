import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { AppError, conflict, forbidden, notFound } from '../../common/errors.js';
import { Events, type MessageEvent, type ReportedEvent } from '../../common/events.js';
import { AuditService } from '../../core/audit.service.js';
import { ChallengesService } from '../challenges/challenges.service.js';
import { Challenge, Participant } from '../challenges/entities/challenge.entities.js';
import { person } from '../challenges/views.js';
import { OrgMember } from '../organizations/entities/organization.entities.js';
import { User } from '../users/entities/user.entities.js';
import { ChatMute, FeedItem, Message, Reaction, Report } from './entities/community.entities.js';

const EMOJI = new Set(['🔥', '❤️', '👏', '💪', '😂', '🎉', '👀', '🙏', '💯', '🚀']);
/** Reports from this many people hide a message until a moderator looks. */
const AUTO_HIDE_AT = 3;

@Injectable()
export class CommunityService {
  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Reaction) private readonly reactions: Repository<Reaction>,
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(FeedItem) private readonly feed: Repository<FeedItem>,
    @InjectRepository(ChatMute) private readonly mutes: Repository<ChatMute>,
    @InjectRepository(Participant) private readonly participants: Repository<Participant>,
    @InjectRepository(Challenge) private readonly challenges: Repository<Challenge>,
    @InjectRepository(OrgMember) private readonly members: Repository<OrgMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly challengesService: ChallengesService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /** Chat is for the people in the challenge and its hosts. */
  async access(slug: string, userId: string) {
    const c = await this.challengesService.bySlug(slug);
    const moderator = await this.isModerator(c, userId);
    const member = await this.participants.existsBy({ challengeId: c.id, userId, status: In(['active', 'completed', 'failed']) });
    if (!member && !moderator) throw forbidden('Join this challenge to read and post in its chat.');
    return { c, moderator };
  }

  async idFor(slug: string) {
    return (await this.challengesService.bySlug(slug)).id;
  }

  async isModerator(c: Challenge, userId: string) {
    if (c.creatorId === userId) return true;
    const u = await this.users.findOneBy({ id: userId });
    if (u?.adminRole) return true;
    if (!c.orgId) return false;
    const m = await this.members.findOneBy({ orgId: c.orgId, userId });
    return Boolean(m && ['Owner', 'Admin', 'Moderator'].includes(m.role));
  }

  async list(slug: string, userId: string, before?: string) {
    const { c } = await this.access(slug, userId);
    const rows = await this.messages.find({
      where: { challengeId: c.id, hiddenAt: IsNull(), ...(before ? { createdAt: LessThan(new Date(before)) } : {}) },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const pinned = before ? [] : await this.messages.find({ where: { challengeId: c.id, pinned: true, hiddenAt: IsNull() }, order: { createdAt: 'DESC' }, take: 5 });
    const all = [...new Map([...pinned, ...rows].map((m) => [m.id, m])).values()];
    return { items: await this.views(all, userId), hasMore: rows.length === 50 };
  }

  async views(list: Message[], viewerId: string) {
    if (!list.length) return [];
    const users = await this.users.findBy({ id: In([...new Set(list.map((m) => m.authorId))]) });
    const reacts = await this.reactions.findBy({ messageId: In(list.map((m) => m.id)) });
    return list.map((m) => {
      const mine = reacts.filter((r) => r.messageId === m.id);
      const grouped = new Map<string, { emoji: string; count: number; mine?: boolean }>();
      for (const r of mine) {
        const g = grouped.get(r.emoji) ?? { emoji: r.emoji, count: 0 };
        g.count++;
        if (r.userId === viewerId) g.mine = true;
        grouped.set(r.emoji, g);
      }
      return {
        id: m.id,
        person: person(users.find((u) => u.id === m.authorId)!),
        at: m.createdAt.toISOString(),
        body: m.body,
        pinned: m.pinned || undefined,
        announcement: m.announcement || undefined,
        replyTo: m.replyToId ?? undefined,
        edited: Boolean(m.editedAt) || undefined,
        reactions: [...grouped.values()],
      };
    });
  }

  async post(slug: string, userId: string, body: string, replyToId?: string, announcement = false) {
    const { c, moderator } = await this.access(slug, userId);
    const user = await this.users.findOneByOrFail({ id: userId });
    if (user.status !== 'active') throw forbidden('Your account is under review, so you can’t post right now.');
    const mute = await this.mutes.findOne({ where: [{ userId, challengeId: c.id }, { userId, challengeId: IsNull() }], order: { createdAt: 'DESC' } });
    if (mute && (!mute.until || mute.until > new Date())) {
      throw forbidden(mute.until ? `You can post again after ${mute.until.toUTCString().slice(0, 22)}.` : 'You can’t post in this chat. Contact support if you think this is a mistake.');
    }
    if (announcement && !moderator) throw forbidden('Only hosts and moderators can post announcements.');
    let replyAuthor: string | undefined;
    if (replyToId) {
      const parent = await this.messages.findOneBy({ id: replyToId, challengeId: c.id });
      if (!parent) throw notFound('message');
      replyAuthor = parent.authorId;
    }
    const handles = [...new Set([...body.matchAll(/@([a-z0-9_]{3,20})/gi)].map((m) => m[1].toLowerCase()))].slice(0, 10);
    const mentioned = handles.length ? await this.users.findBy({ handle: In(handles) }) : [];
    // Only people who can read this chat get mentioned: participants, the host and moderators.
    const mentions: string[] = [];
    for (const u of mentioned) {
      if (u.id === userId) continue;
      const inChat = (await this.participants.existsBy({ challengeId: c.id, userId: u.id })) || (await this.isModerator(c, u.id));
      if (inChat) mentions.push(u.id);
    }
    const m = await this.messages.save(this.messages.create({ challengeId: c.id, authorId: userId, body: body.trim(), replyToId: replyToId ?? null, mentions, announcement, pinned: announcement }));
    const [view] = await this.views([m], userId);
    this.events.emit(Events.MessagePosted, { messageId: m.id, challengeId: c.id, authorId: userId, mentions, replyToAuthorId: replyAuthor } satisfies MessageEvent);
    this.events.emit('community.live', { room: `challenge:${c.id}`, event: 'message', payload: view });
    return view;
  }

  async edit(userId: string, id: string, body: string) {
    const m = await this.messages.findOneBy({ id, authorId: userId, hiddenAt: IsNull() });
    if (!m) throw notFound('message');
    if (Date.now() - m.createdAt.getTime() > 15 * 60_000) throw conflict('edit_window', 'Messages can be edited for 15 minutes after posting.');
    m.body = body.trim();
    m.editedAt = new Date();
    await this.messages.save(m);
    const [view] = await this.views([m], userId);
    this.events.emit('community.live', { room: `challenge:${m.challengeId}`, event: 'message_updated', payload: view });
    return view;
  }

  async remove(userId: string, id: string, reason = 'Deleted by author') {
    const m = await this.messages.findOneBy({ id });
    if (!m) throw notFound('message');
    const c = await this.challenges.findOneByOrFail({ id: m.challengeId });
    const mod = m.authorId !== userId && (await this.isModerator(c, userId));
    if (m.authorId !== userId && !mod) throw forbidden();
    await this.messages.update({ id }, { hiddenAt: new Date(), hiddenById: userId, hiddenReason: reason });
    if (mod) await this.audit.log(userId, 'Removed message', `Message ${id} in ${c.title}`, reason);
    this.events.emit('community.live', { room: `challenge:${m.challengeId}`, event: 'message_removed', payload: { id } });
  }

  async pin(userId: string, id: string, pinned: boolean) {
    const m = await this.messages.findOneBy({ id, hiddenAt: IsNull() });
    if (!m) throw notFound('message');
    const c = await this.challenges.findOneByOrFail({ id: m.challengeId });
    if (!(await this.isModerator(c, userId))) throw forbidden('Only hosts and moderators can pin messages.');
    await this.messages.update({ id }, { pinned });
    this.events.emit('community.live', { room: `challenge:${m.challengeId}`, event: 'message_updated', payload: (await this.views([Object.assign(m, { pinned })], userId))[0] });
  }

  async react(userId: string, id: string, emoji: string) {
    if (!EMOJI.has(emoji)) throw new AppError('invalid_reaction', 'That reaction isn’t available.');
    const m = await this.messages.findOneBy({ id, hiddenAt: IsNull() });
    if (!m) throw notFound('message');
    const c = await this.challenges.findOneByOrFail({ id: m.challengeId });
    await this.access(c.slug, userId);
    // Toggle, so a second tap removes it.
    const existing = await this.reactions.findOneBy({ messageId: id, userId, emoji });
    if (existing) await this.reactions.delete({ id: existing.id });
    else await this.reactions.save(this.reactions.create({ messageId: id, userId, emoji }));
    const [view] = await this.views([m], userId);
    this.events.emit('community.live', { room: `challenge:${m.challengeId}`, event: 'reaction', payload: { id, reactions: view.reactions.map((r) => ({ emoji: r.emoji, count: r.count })) } });
    return view.reactions;
  }

  async mute(moderatorId: string, slug: string, targetHandle: string, hours: number | null, reason: string) {
    const c = await this.challengesService.bySlug(slug);
    if (!(await this.isModerator(c, moderatorId))) throw forbidden();
    const target = await this.users.findOneBy({ handle: targetHandle.toLowerCase() });
    if (!target) throw notFound('member');
    await this.mutes.save(this.mutes.create({ userId: target.id, challengeId: c.id, until: hours ? new Date(Date.now() + hours * 3600_000) : null, reason, byId: moderatorId }));
    await this.audit.log(moderatorId, 'Restricted chat', `@${target.handle} in ${c.title}`, reason);
  }

  // ---------- reports ----------

  async report(reporterId: string, dto: { kind: 'message' | 'account' | 'challenge'; targetId: string; reason: string; detail?: string }) {
    let subjectUserId: string;
    let challengeId: string | null = null;
    if (dto.kind === 'message') {
      const m = await this.messages.findOneBy({ id: dto.targetId });
      if (!m) throw notFound('message');
      subjectUserId = m.authorId;
      challengeId = m.challengeId;
    } else if (dto.kind === 'account') {
      const u = await this.users.findOneBy({ handle: dto.targetId.toLowerCase() });
      if (!u) throw notFound('member');
      subjectUserId = u.id;
      dto.targetId = u.id;
    } else {
      const c = await this.challenges.findOneBy({ slug: dto.targetId });
      if (!c) throw notFound('challenge');
      subjectUserId = c.creatorId;
      challengeId = c.id;
      dto.targetId = c.id;
    }
    if (subjectUserId === reporterId) throw new AppError('self_report', 'You can’t report yourself.');
    const saved = await this.reports
      .createQueryBuilder()
      .insert()
      .values({ kind: dto.kind, targetId: dto.targetId, subjectUserId, challengeId, reporterId, reason: dto.reason, detail: dto.detail ?? '' })
      .orIgnore()
      .execute();
    if (dto.kind === 'message') {
      const count = await this.reports.countBy({ kind: 'message', targetId: dto.targetId, status: 'open' });
      if (count >= AUTO_HIDE_AT) await this.messages.update({ id: dto.targetId, hiddenAt: IsNull() }, { hiddenAt: new Date(), hiddenReason: 'Hidden after several reports, pending review' });
    }
    if (saved.identifiers[0]) this.events.emit(Events.Reported, { reportId: saved.identifiers[0].id as string, subjectUserId } satisfies ReportedEvent);
    return { received: true };
  }

  /** Grouped by target for the admin queue. */
  async openReports() {
    const rows = await this.reports.find({ where: { status: 'open' }, order: { createdAt: 'DESC' }, take: 500 });
    const groups = new Map<string, Report[]>();
    for (const r of rows) groups.set(`${r.kind}:${r.targetId}`, [...(groups.get(`${r.kind}:${r.targetId}`) ?? []), r]);
    const authors = rows.length ? await this.users.findBy({ id: In([...new Set(rows.map((r) => r.subjectUserId))]) }) : [];
    const cs = rows.length ? await this.challenges.findBy({ id: In(rows.map((r) => r.challengeId).filter((x): x is string => Boolean(x))) }) : [];
    const msgs = rows.length ? await this.messages.findBy({ id: In(rows.filter((r) => r.kind === 'message').map((r) => r.targetId)) }) : [];
    return [...groups.values()].map((list) => {
      const r = list[0];
      return {
        id: r.id,
        kind: r.kind,
        targetId: r.targetId,
        author: person(authors.find((u) => u.id === r.subjectUserId)!),
        challenge: cs.find((c) => c.id === r.challengeId)?.title ?? null,
        body: msgs.find((m) => m.id === r.targetId)?.body ?? r.detail,
        reason: r.reason,
        reporters: list.length,
        at: r.createdAt.toISOString(),
      };
    });
  }

  async resolveReport(adminId: string, reportId: string, action: 'dismiss' | 'remove' | 'mute', reason: string) {
    const r = await this.reports.findOneBy({ id: reportId });
    if (!r) throw notFound('report');
    if (action === 'remove' && r.kind === 'message') await this.messages.update({ id: r.targetId }, { hiddenAt: new Date(), hiddenById: adminId, hiddenReason: reason });
    if (action === 'dismiss' && r.kind === 'message') await this.messages.update({ id: r.targetId, hiddenReason: 'Hidden after several reports, pending review' }, { hiddenAt: null, hiddenReason: null });
    if (action === 'mute') await this.mutes.save(this.mutes.create({ userId: r.subjectUserId, challengeId: null, until: new Date(Date.now() + 7 * 86_400_000), reason, byId: adminId }));
    await this.reports.update({ kind: r.kind, targetId: r.targetId, status: 'open' }, { status: action === 'dismiss' ? 'dismissed' : 'actioned', resolution: reason });
    await this.audit.log(adminId, action === 'dismiss' ? 'Dismissed report' : action === 'remove' ? 'Removed reported message' : 'Restricted chat', `Report ${reportId}`, reason);
  }

  // ---------- feed ----------

  async feedFor(slug: string, viewerId?: string) {
    const c = await this.challengesService.visible(slug, viewerId);
    const rows = await this.feed.find({ where: { challengeId: c.id, createdAt: MoreThan(new Date(Date.now() - 14 * 86_400_000)) }, order: { createdAt: 'DESC' }, take: 50 });
    return rows.map((f) => ({ id: f.id, at: f.createdAt.toISOString(), text: f.text, kind: f.kind }));
  }

  /** Optional progress updates people choose to share (PRD §12). */
  async share(userId: string, slug: string, text: string) {
    const { c } = await this.access(slug, userId);
    const u = await this.users.findOneByOrFail({ id: userId });
    const item = await this.feed.save(this.feed.create({ challengeId: c.id, userId, kind: 'share', text: `${u.name.split(' ')[0]}: ${text.trim()}` }));
    this.events.emit('community.live', { room: `challenge:${c.id}`, event: 'feed', payload: { id: item.id, at: item.createdAt.toISOString(), text: item.text, kind: item.kind } });
    return { id: item.id };
  }
}
