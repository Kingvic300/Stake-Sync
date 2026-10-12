import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity.js';

@Entity('sessions')
export class Session extends BaseEntity {
  @Index()
  @Column('uuid')
  userId: string;

  /** sha256 of the current refresh token. Rotated on every refresh. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  refreshHash: string;

  /** sha256 of the previous refresh token, to detect replay of a stolen one. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  previousHash: string | null;

  @Column({ default: false })
  admin: boolean;

  /** Admin session that passed two-step verification. */
  @Column({ default: false })
  mfa: boolean;

  @Column({ type: 'varchar', default: '' })
  userAgent: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipHash: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}

export type AuthTokenKind = 'verify_email' | 'reset_password' | 'wallet_nonce' | 'oauth_state' | 'admin_mfa';

/** Single-use tokens. Only hashes are stored. */
@Entity('auth_tokens')
export class AuthToken extends BaseEntity {
  @Column({ type: 'varchar', length: 20 })
  kind: AuthTokenKind;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'jsonb', default: {} })
  data: Record<string, unknown>;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
