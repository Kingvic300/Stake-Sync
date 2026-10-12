import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AppError, conflict, notFound } from '../../common/errors.js';
import { AuditService } from '../../core/audit.service.js';
import { SettingsService, type PenaltyStructure } from '../../core/settings.service.js';
import { Session } from '../auth/entities/auth.entities.js';
import { DisputesService } from '../disputes/disputes.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RiskFlag } from '../risk/entities/risk.entities.js';
import { User } from '../users/entities/user.entities.js';
import { Approval, type ApprovalAction } from './entities/admin.entities.js';

const LABEL: Record<ApprovalAction, string> = {
  confirm_dispute_failure: 'Confirm failure',
  restrict_account: 'Restrict account',
  suspend_account: 'Suspend account',
  change_penalty_structures: 'Change penalty structure',
};

/** Four-eyes rule: high-impact admin actions wait for a second admin (admin app, PRD §29). */
@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(Approval) private readonly approvals: Repository<Approval>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RiskFlag) private readonly flags: Repository<RiskFlag>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly disputes: DisputesService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async request(adminId: string, action: ApprovalAction, target: string, payload: Record<string, unknown>, reason: string) {
    const dupe = await this.approvals.findOneBy({ action, target, status: 'pending' });
    if (dupe) throw conflict('already_requested', 'This is already waiting for a second approval.');
    const a = await this.approvals.save(this.approvals.create({ action, target, payload, reason, requestedById: adminId }));
    await this.audit.log(adminId, `Requested approval: ${LABEL[action]}`, target, reason);
    return { status: 'pending_approval' as const, approvalId: a.id };
  }

  async pending() {
    const rows = await this.approvals.find({ where: { status: 'pending' }, order: { createdAt: 'DESC' } });
    const users = rows.length ? await this.users.findBy({ id: In(rows.map((r) => r.requestedById)) }) : [];
    return rows.map((r) => ({
      id: r.id,
      action: LABEL[r.action],
      target: r.target,
      reason: r.reason,
      requestedBy: users.find((u) => u.id === r.requestedById)?.name ?? 'Unknown',
      requestedById: r.requestedById,
      at: r.createdAt.toISOString(),
    }));
  }

  async decide(adminId: string, id: string, approve: boolean) {
    const a = await this.approvals.findOneBy({ id, status: 'pending' });
    if (!a) throw notFound('approval');
    if (a.requestedById === adminId) throw new AppError('same_admin', 'A different admin has to approve this. That’s the point of the four-eyes rule.', HttpStatus.FORBIDDEN);
    await this.approvals.update({ id }, { status: approve ? 'approved' : 'declined', decidedById: adminId, decidedAt: new Date() });
    const requester = await this.users.findOneBy({ id: a.requestedById });
    await this.audit.log(adminId, `${approve ? 'Approved' : 'Declined'}: ${LABEL[a.action]}`, a.target, `Second approver for request by ${requester?.name ?? 'unknown'}`);
    if (approve) await this.execute(a, adminId);
    return { status: approve ? 'approved' : 'declined' };
  }

  private async execute(a: Approval, approverId: string) {
    const p = a.payload;
    switch (a.action) {
      case 'confirm_dispute_failure':
        await this.disputes.decide(a.requestedById, p.disputeId as string, false, a.reason);
        break;
      case 'restrict_account':
      case 'suspend_account': {
        const status = a.action === 'restrict_account' ? 'restricted' : 'suspended';
        await this.users.update({ id: p.userId as string }, { status, statusReason: a.reason });
        await this.flags.update({ userId: p.userId as string, status: In(['open', 'watching']) }, { status: 'restricted', decidedById: approverId, decisionReason: a.reason });
        if (status === 'suspended') await this.sessions.update({ userId: p.userId as string, revokedAt: IsNull() }, { revokedAt: new Date() });
        await this.notifications.notify(p.userId as string, {
          kind: 'problem',
          title: status === 'restricted' ? 'Your account is under review' : 'Your account is suspended',
          body:
            status === 'restricted'
              ? "While we review some activity, you can't join new challenges or post in chat. Your stakes and payouts are unaffected. Reply to our email if you think this is a mistake."
              : 'Email stakesync2@gmail.com to understand what happens next. Money in active challenges stays safe in escrow and is paid out under the rules.',
          href: '/profile',
          email: true,
        });
        break;
      }
      case 'change_penalty_structures':
        await this.settings.set('penalty_structures', p.structures as PenaltyStructure[], approverId);
        break;
    }
  }
}
