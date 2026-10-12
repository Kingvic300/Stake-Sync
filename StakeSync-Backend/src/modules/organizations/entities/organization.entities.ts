import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';

export type OrgKind = 'Community' | 'University' | 'Company' | 'Brand';
export type OrgPlan = 'Community' | 'Organization' | 'Sponsored campaign';
export type OrgRole = 'Owner' | 'Admin' | 'Moderator' | 'Member';

@Entity('organizations')
export class Organization extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 48 })
  slug: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'Community' })
  kind: OrgKind;

  @Column({ type: 'varchar', length: 500, default: '' })
  about: string;

  @Column({ type: 'int', default: 250 })
  hue: number;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 24, default: 'Community' })
  plan: OrgPlan;

  /** Organizations can create challenges once a Stake-Sync admin verifies them. */
  @Column({ type: 'varchar', length: 12, default: 'pending' })
  verification: 'pending' | 'verified' | 'rejected';

  @Column({ type: 'varchar', nullable: true })
  verificationReason: string | null;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 24 })
  inviteCode: string;

  @Column('uuid')
  createdById: string;
}

@Entity('org_members')
@Unique(['orgId', 'userId'])
export class OrgMember extends BaseEntity {
  @Index()
  @Column('uuid')
  orgId: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 12, default: 'Member' })
  role: OrgRole;
}

/** Organization- or challenge-level announcement (PRD §12, §14). */
@Entity('announcements')
export class Announcement extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', nullable: true })
  orgId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  challengeId: string | null;

  @Column('uuid')
  authorId: string;

  @Column({ type: 'varchar', length: 2000 })
  body: string;

  @Column({ default: false })
  pinned: boolean;

  @Column({ type: 'int', default: 0 })
  reach: number;
}
