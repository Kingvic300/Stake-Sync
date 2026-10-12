// Domain events. Modules publish facts; others react (notifications, reputation, risk, feed)
// without importing each other.

export const Events = {
  UserSignedUp: 'user.signed_up',
  AccountLinked: 'account.linked',
  WalletLinked: 'wallet.linked',
  ChallengeCreated: 'challenge.created',
  ChallengeStarted: 'challenge.started',
  ChallengeCancelled: 'challenge.cancelled',
  ChallengeFinalized: 'challenge.finalized',
  ParticipantJoined: 'participant.joined',
  ParticipantSettled: 'participant.settled',
  PeriodDecided: 'verification.period_decided',
  ProofSubmitted: 'verification.proof_submitted',
  DisputeOpened: 'dispute.opened',
  DisputeUpdated: 'dispute.updated',
  Claimed: 'payments.claimed',
  Sponsored: 'payments.sponsored',
  MessagePosted: 'community.message_posted',
  Reported: 'community.reported',
} as const;

export interface PeriodDecidedEvent {
  verificationId: string;
  participantId: string;
  challengeId: string;
  userId: string;
  period: number;
  state: 'verified' | 'failed' | 'excused';
}

export interface ParticipantEvent {
  participantId: string;
  challengeId: string;
  userId: string;
}

export interface ChallengeEvent {
  challengeId: string;
}

export interface UserEvent {
  userId: string;
  ip?: string;
  device?: string;
}

export interface LinkedEvent {
  userId: string;
  provider: string;
  externalId: string;
  externalCreatedAt?: Date | null;
}

export interface WalletLinkedEvent {
  userId: string;
  address: string;
  kind: 'external' | 'embedded';
}

export interface ProofSubmittedEvent {
  proofId: string;
  userId: string;
  challengeId: string;
}

export interface DisputeEvent {
  disputeId: string;
  userId: string;
  challengeId: string;
}

export interface MoneyEvent {
  userId: string;
  challengeId?: string;
  amount: bigint;
  signature?: string;
}

export interface MessageEvent {
  messageId: string;
  challengeId: string;
  authorId: string;
  mentions: string[];
  replyToAuthorId?: string;
}

export interface ReportedEvent {
  reportId: string;
  subjectUserId: string;
}
