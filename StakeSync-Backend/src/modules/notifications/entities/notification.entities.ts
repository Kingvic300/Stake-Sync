import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';

/** Matches the apps' notification kinds (PRD §25). */
export type NotificationKind =
  | 'starting'
  | 'verified'
  | 'deadline'
  | 'strike'
  | 'penalty'
  | 'message'
  | 'leaderboard'
  | 'completed'
  | 'reward'
  | 'dispute'
  | 'announcement'
  | 'activity'
  | 'problem';

@Entity('notifications')
@Unique(['userId', 'dedupeKey'])
export class Notification extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 14 })
  kind: NotificationKind;

  @Column({ type: 'varchar', length: 140 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  @Column({ type: 'varchar', length: 200 })
  href: string;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  /** Same key never notifies twice (anti-spam, PRD §25). */
  @Column({ type: 'varchar', length: 160, nullable: true })
  dedupeKey: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pushedAt: Date | null;
}

@Entity('push_subscriptions')
export class PushSubscription extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 1000 })
  endpoint: string;

  @Column({ type: 'jsonb' })
  keys: { p256dh: string; auth: string };
}
