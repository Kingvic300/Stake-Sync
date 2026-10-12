import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { User } from '../users/entities/user.entities.js';
import { Notification, type NotificationKind } from './entities/notification.entities.js';
import { MailService } from './mail.service.js';
import { PushService } from './push.service.js';

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  /** Same key → notified once. */
  dedupeKey?: string;
  /** Also email it (respecting preferences). Reserved for things worth an email. */
  email?: boolean;
  emailAction?: string;
  /** In-app only, no push: routine updates that shouldn't buzz a phone. */
  quiet?: boolean;
}

/** Kinds people can't mute: they're about their money or a problem that needs them. */
const ALWAYS = new Set<NotificationKind>(['reward', 'dispute', 'penalty', 'problem']);

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly events: EventEmitter2,
  ) {}

  async notify(userId: string, n: NotifyInput) {
    const user = await this.users.findOneBy({ id: userId });
    if (!user || user.status === 'closed') return null;
    const prefs = user.notificationPrefs;
    if (!ALWAYS.has(n.kind) && prefs.muted.includes(n.kind)) return null;

    if (n.dedupeKey && (await this.repo.existsBy({ userId, dedupeKey: n.dedupeKey }))) return null;
    let saved: Notification;
    try {
      saved = await this.repo.save(
        this.repo.create({ userId, kind: n.kind, title: n.title, body: n.body, href: n.href, dedupeKey: n.dedupeKey ?? null }),
      );
    } catch {
      return null; // lost a dedupe race
    }
    this.events.emit('notification.created', { userId, notification: this.view(saved) });

    if (prefs.push && !n.quiet && (await this.push.send(userId, { title: n.title, body: n.body, href: n.href }))) {
      saved.pushedAt = new Date();
    }
    if (n.email && prefs.email && user.email && user.emailVerifiedAt) {
      await this.mail.send(user.email, n.title, n.body, { label: n.emailAction ?? 'Open Stake-Sync', href: n.href });
      saved.emailedAt = new Date();
    }
    if (saved.pushedAt || saved.emailedAt) await this.repo.save(saved);
    return saved;
  }

  notifyMany(userIds: string[], n: NotifyInput) {
    return Promise.all(userIds.map((id) => this.notify(id, n)));
  }

  async list(userId: string, before?: string, limit = 30) {
    const rows = await this.repo.find({
      where: { userId, ...(before ? { createdAt: LessThan(new Date(before)) } : {}) },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });
    const unread = await this.repo.countBy({ userId, readAt: IsNull() });
    return { items: rows.map((r) => this.view(r)), unread };
  }

  async markRead(userId: string, ids: string[]) {
    if (ids.length) await this.repo.createQueryBuilder().update().set({ readAt: () => 'now()' }).where('user_id = :userId AND id IN (:...ids)', { userId, ids }).execute();
  }

  async markAllRead(userId: string) {
    await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
  }

  async remove(userId: string, id: string) {
    await this.repo.delete({ userId, id });
  }

  view(n: Notification) {
    return { id: n.id, kind: n.kind, at: n.createdAt.toISOString(), title: n.title, body: n.body, href: n.href, unread: !n.readAt };
  }
}
