import { ErrorGroup, ServerLog } from '../core/logs/log.entities.js';
import { AuditEntry, Approval } from '../modules/admin/entities/admin.entities.js';
import { AuthToken, Session } from '../modules/auth/entities/auth.entities.js';
import { Challenge, ChallengeRule, Participant } from '../modules/challenges/entities/challenge.entities.js';
import { ChatMute, FeedItem, Message, Reaction, Report } from '../modules/community/entities/community.entities.js';
import { Dispute } from '../modules/disputes/entities/dispute.entity.js';
import { Notification, PushSubscription } from '../modules/notifications/entities/notification.entities.js';
import { Announcement, OrgMember, Organization } from '../modules/organizations/entities/organization.entities.js';
import {
  ChainEvent,
  LedgerEntry,
  Setting,
  SponsorContribution,
} from '../modules/payments/entities/payment.entities.js';
import { OnrampEvent, OnrampSession, OnrampTransaction } from '../modules/payments/entities/onramp.entities.js';
import { Achievement, ReputationRecord } from '../modules/reputation/entities/reputation.entities.js';
import { RiskFlag, RiskSignal } from '../modules/risk/entities/risk.entities.js';
import { ConnectedAccount, User, Wallet } from '../modules/users/entities/user.entities.js';
import { ProofSubmission, ProviderIncident, Verification } from '../modules/verification/entities/verification.entities.js';

export const ENTITIES = [
  User,
  ConnectedAccount,
  Wallet,
  Session,
  AuthToken,
  Organization,
  OrgMember,
  Announcement,
  Challenge,
  ChallengeRule,
  Participant,
  Verification,
  ProofSubmission,
  ProviderIncident,
  LedgerEntry,
  SponsorContribution,
  ChainEvent,
  Setting,
  OnrampSession,
  OnrampTransaction,
  OnrampEvent,
  Message,
  Reaction,
  Report,
  FeedItem,
  ChatMute,
  Dispute,
  Notification,
  PushSubscription,
  Achievement,
  ReputationRecord,
  RiskSignal,
  RiskFlag,
  AuditEntry,
  Approval,
  ServerLog,
  ErrorGroup,
];
