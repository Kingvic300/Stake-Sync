import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';

@Entity('messages')
export class Message extends BaseEntity {
  @Index()
  @Column('uuid')
  challengeId: string;

  @Index()
  @Column('uuid')
  authorId: string;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @Column({ type: 'uuid', nullable: true })
  replyToId: string | null;

  @Column({ type: 'uuid', array: true, default: '{}' })
  mentions: string[];

  @Column({ default: false })
  pinned: boolean;

  /** Posted by the creator, an org moderator or a Stake-Sync admin as an announcement. */
  @Column({ default: false })
  announcement: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  hiddenAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  hiddenById: string | null;

  @Column({ type: 'varchar', nullable: true })
  hiddenReason: string | null;
}

@Entity('reactions')
@Unique(['messageId', 'userId', 'emoji'])
export class Reaction extends BaseEntity {
  @Index()
  @Column('uuid')
  messageId: string;

  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  emoji: string;
}

@Entity('reports')
@Unique(['kind', 'targetId', 'reporterId'])
export class Report extends BaseEntity {
  @Column({ type: 'varchar', length: 10 })
  kind: 'message' | 'account' | 'challenge';

  @Index()
  @Column('uuid')
  targetId: string;

  /** The person the report is about (message author, account, challenge creator). */
  @Index()
  @Column('uuid')
  subjectUserId: string;

  @Column({ type: 'uuid', nullable: true })
  challengeId: string | null;

  @Column('uuid')
  reporterId: string;

  @Column({ type: 'varchar', length: 40 })
  reason: string;

  @Column({ type: 'varchar', length: 1000, default: '' })
  detail: string;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: 'open' | 'actioned' | 'dismissed';

  @Column({ type: 'varchar', nullable: true })
  resolution: string | null;
}

/** "Samuel completed Day 17", "Hailey moved into the top 10" (PRD §12). */
@Entity('feed_items')
export class FeedItem extends BaseEntity {
  @Index()
  @Column('uuid')
  challengeId: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 10 })
  kind: 'day' | 'rank' | 'milestone' | 'share';

  @Column({ type: 'varchar', length: 280 })
  text: string;

  /** One milestone per key, so repeated jobs don't duplicate items. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160, nullable: true })
  dedupeKey: string | null;
}

/** Chat restriction. challengeId null means everywhere. */
@Entity('chat_mutes')
export class ChatMute extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  challengeId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  until: Date | null;

  @Column({ type: 'varchar' })
  reason: string;

  @Column('uuid')
  byId: string;
}
