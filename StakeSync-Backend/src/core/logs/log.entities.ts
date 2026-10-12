import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type LogLevel = 'info' | 'warn' | 'error';
/** request: one per HTTP request. app: messages from services and jobs. security: suspicious or blocked activity. error: an exception. */
export type LogKind = 'request' | 'app' | 'security' | 'error';

/** The server log the admin app shows. Written in batches; old rows are pruned by level. */
@Entity('server_logs')
@Index(['createdAt'])
export class ServerLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Index()
  @Column({ type: 'varchar', length: 5 })
  level: LogLevel;

  @Index()
  @Column({ type: 'varchar', length: 8 })
  kind: LogKind;

  @Column({ type: 'varchar', length: 60, default: '' })
  context: string;

  @Column({ type: 'varchar', length: 1000 })
  message: string;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  requestId: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  path: string | null;

  @Column({ type: 'int', nullable: true })
  status: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  userAgent: string | null;

  @Column({ type: 'jsonb', default: {} })
  meta: Record<string, unknown>;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  errorGroupId: string | null;

  @Column({ type: 'text', nullable: true })
  stack: string | null;
}

/** Repeats of the same error grouped together, so each problem is one row with a count. */
@Entity('error_groups')
export class ErrorGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ type: 'varchar', length: 1000 })
  message: string;

  @Column({ type: 'varchar', length: 60, default: '' })
  context: string;

  /** Route or job where it happens most recently. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  where: string | null;

  @Column({ type: 'int', default: 1 })
  count: number;

  @Column({ type: 'timestamptz' })
  firstSeen: Date;

  @Index()
  @Column({ type: 'timestamptz' })
  lastSeen: Date;

  @Index()
  @Column({ type: 'varchar', length: 10, default: 'open' })
  status: 'open' | 'resolved';

  @Column({ type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  resolution: string | null;

  @Column({ type: 'text', nullable: true })
  sampleStack: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  lastRequestId: string | null;
}
