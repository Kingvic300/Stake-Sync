import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';

/** Every admin action, with a reason (PRD §29). Append-only. */
@Entity('audit_entries')
export class AuditEntry extends BaseEntity {
  /** null for the system. */
  @Column({ type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar', length: 80 })
  actorName: string;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 200 })
  target: string;

  @Column({ type: 'varchar', length: 1000 })
  reason: string;

  @Column({ type: 'jsonb', default: {} })
  meta: Record<string, unknown>;
}

export type ApprovalAction = 'confirm_dispute_failure' | 'restrict_account' | 'suspend_account' | 'change_penalty_structures';

/** Four-eyes rule: high-impact actions wait for a second admin. */
@Entity('approvals')
export class Approval extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  action: ApprovalAction;

  @Column({ type: 'varchar', length: 200 })
  target: string;

  /** What to execute once approved. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 1000 })
  reason: string;

  @Column('uuid')
  requestedById: string;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: 'pending' | 'approved' | 'declined';

  @Column({ type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;
}
