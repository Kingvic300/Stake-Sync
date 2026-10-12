import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1791522257396 implements MigrationInterface {
  name = 'Init1791522257396';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE "audit_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actor_id" uuid, "actor_name" character varying(80) NOT NULL, "action" character varying(80) NOT NULL, "target" character varying(200) NOT NULL, "reason" character varying(1000) NOT NULL, "meta" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_6b1623bcad4d04530b76548d619" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7064857330342779b2bbd4584c" ON "audit_entries"  ("action") `,
    );
    await queryRunner.query(
      `CREATE TABLE "approvals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "action" character varying(40) NOT NULL, "target" character varying(200) NOT NULL, "payload" jsonb NOT NULL, "reason" character varying(1000) NOT NULL, "requested_by_id" uuid NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'pending', "decided_by_id" uuid, "decided_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_690417aaefa84d18b1a59e2a499" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0b9522f4648b5b18f28ba6a9ae" ON "approvals"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "refresh_hash" character varying(64) NOT NULL, "previous_hash" character varying(64), "admin" boolean NOT NULL DEFAULT false, "user_agent" character varying NOT NULL DEFAULT '', "ip_hash" character varying(64), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_085d540d9f418cfbdc7bd55bb1" ON "sessions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0be384894b8949610f7915d19b" ON "sessions"  ("refresh_hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(20) NOT NULL, "token_hash" character varying(64) NOT NULL, "user_id" uuid, "data" jsonb NOT NULL DEFAULT '{}', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_41e9ddfbb32da18c4e85e45c2fd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3a94cfa1eada85ac2bf6f3016b" ON "auth_tokens"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "challenges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "slug" character varying(64) NOT NULL, "title" character varying(90) NOT NULL, "summary" character varying(160) NOT NULL, "description" text NOT NULL, "category" character varying(24) NOT NULL, "providers" text array NOT NULL, "verification_config" jsonb NOT NULL DEFAULT '{}', "creator_id" uuid NOT NULL, "org_id" uuid, "banner_url" character varying, "privacy" character varying(8) NOT NULL DEFAULT 'public', "participant_limit" integer, "stake_mode" character varying(8) NOT NULL, "stake_min" numeric(20,0) NOT NULL DEFAULT '0', "stake_max" numeric(20,0) NOT NULL DEFAULT '0', "sponsor_pool" numeric(20,0) NOT NULL DEFAULT '0', "sponsor_pledge" numeric(20,0) NOT NULL DEFAULT '0', "mode" character varying(8) NOT NULL, "duration_days" integer NOT NULL, "period_secs" integer NOT NULL DEFAULT '86400', "period_count" integer NOT NULL, "required_periods" integer NOT NULL, "target_count" integer, "count_unit" character varying(24), "requirement" character varying(200) NOT NULL, "penalty_preset" character varying(12) NOT NULL, "free_strikes" integer NOT NULL, "penalties_bps" integer array NOT NULL, "freeze_periods" integer NOT NULL DEFAULT '0', "dispute_window_secs" integer NOT NULL DEFAULT '172800', "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "join_by" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL, "timezone" character varying(64) NOT NULL DEFAULT 'Africa/Lagos', "difficulty" character varying(8) NOT NULL DEFAULT 'Steady', "verification_level" character varying(16) NOT NULL, "forfeits_to_finishers" boolean NOT NULL DEFAULT true, "status" character varying(16) NOT NULL DEFAULT 'pending_chain', "moderation_hold" character varying, "invite_code" character varying(16) NOT NULL, "participant_count" integer NOT NULL DEFAULT '0', "fee_bps" integer NOT NULL DEFAULT '0', "on_chain" boolean NOT NULL DEFAULT true, "chain_id" numeric(20,0), "challenge_pda" character varying(44), "vault_pda" character varying(44), "create_sig" character varying(100), "reward_per_finisher" numeric(20,0), "finisher_count" integer, "settled_at" TIMESTAMP WITH TIME ZONE, "rules_hash" character varying(64) NOT NULL, CONSTRAINT "PK_1e664e93171e20fe4d6125466af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_700e063e7f395178eab9a6d1db" ON "challenges"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52f05c24d1184061261f0c82a5" ON "challenges"  ("creator_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_677a12a7d3b4d8bef12e44c728" ON "challenges"  ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f18516fd67deb6c0d28a3f51db" ON "challenges"  ("starts_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c2c432d50b1ea7990e911a621" ON "challenges"  ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f9fe7ac09a95d392ea777691c9" ON "challenges"  ("invite_code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "challenge_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "challenge_id" uuid NOT NULL, "doc" text NOT NULL, "hash" character varying(64) NOT NULL, CONSTRAINT "PK_6ecdf0ffa20c2b26d31ef06a345" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8ee2b5324ac2014fa210d81c1b" ON "challenge_rules"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "challenge_id" uuid NOT NULL, "user_id" uuid NOT NULL, "wallet" character varying(44), "wallet_kind" character varying(10), "stake" numeric(20,0) NOT NULL DEFAULT '0', "status" character varying(12) NOT NULL DEFAULT 'pending', "accepted_rules_hash" character varying(64) NOT NULL, "accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL, "participant_pda" character varying(44), "join_sig" character varying(100), "activated_at" TIMESTAMP WITH TIME ZONE, "verified_count" integer NOT NULL DEFAULT '0', "missed_count" integer NOT NULL DEFAULT '0', "excused_count" integer NOT NULL DEFAULT '0', "progress" integer NOT NULL DEFAULT '0', "progress_checked_at" TIMESTAMP WITH TIME ZONE, "baseline" jsonb NOT NULL DEFAULT '{}', "freeze_used" boolean NOT NULL DEFAULT false, "freeze_from" integer, "rank" integer, "previous_rank" integer, "settled" boolean NOT NULL DEFAULT false, "completed" boolean, "penalty" numeric(20,0) NOT NULL DEFAULT '0', "claimable" numeric(20,0) NOT NULL DEFAULT '0', "claimed" boolean NOT NULL DEFAULT false, "claim_sig" character varying(100), CONSTRAINT "UQ_0fe142faed686c8300d335dc0fc" UNIQUE ("challenge_id", "user_id"), CONSTRAINT "PK_1cda06c31eec1c95b3365a0283f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_21b7c0286ecb8cb7b4ac865ff1" ON "participants"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1427a77e06023c250ed3794a1b" ON "participants"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "challenge_id" uuid NOT NULL, "author_id" uuid NOT NULL, "body" character varying(2000) NOT NULL, "reply_to_id" uuid, "mentions" uuid array NOT NULL DEFAULT '{}', "pinned" boolean NOT NULL DEFAULT false, "announcement" boolean NOT NULL DEFAULT false, "edited_at" TIMESTAMP WITH TIME ZONE, "hidden_at" TIMESTAMP WITH TIME ZONE, "hidden_by_id" uuid, "hidden_reason" character varying, CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_76ada20bdf1d48bc8c38a97d45" ON "messages"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_05535bc695e9f7ee104616459d" ON "messages"  ("author_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "reactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "emoji" character varying(16) NOT NULL, CONSTRAINT "UQ_d19564cf772d6b6f7a3bbfd7a21" UNIQUE ("message_id", "user_id", "emoji"), CONSTRAINT "PK_0b213d460d0c473bc2fb6ee27f3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2ee227780745018b358237c0ad" ON "reactions"  ("message_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "kind" character varying(10) NOT NULL, "target_id" uuid NOT NULL, "subject_user_id" uuid NOT NULL, "challenge_id" uuid, "reporter_id" uuid NOT NULL, "reason" character varying(40) NOT NULL, "detail" character varying(1000) NOT NULL DEFAULT '', "status" character varying(10) NOT NULL DEFAULT 'open', "resolution" character varying, CONSTRAINT "UQ_c4c89025ba93812eca05e790368" UNIQUE ("kind", "target_id", "reporter_id"), CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8401422324e7fa80304ed708e0" ON "reports"  ("target_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55e740bb1b43f8350bfeb0b3ca" ON "reports"  ("subject_user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dab4d78b3be05c1ca4a626f57f" ON "reports"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "feed_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "challenge_id" uuid NOT NULL, "user_id" uuid, "kind" character varying(10) NOT NULL, "text" character varying(280) NOT NULL, "dedupe_key" character varying(160), CONSTRAINT "PK_9a33f003d604fbe4060d75c7be2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_afe6bda0d38f090210d1ee0ea4" ON "feed_items"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3fa0511636849325444b6e2dc6" ON "feed_items"  ("dedupe_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_mutes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "challenge_id" uuid, "until" TIMESTAMP WITH TIME ZONE, "reason" character varying NOT NULL, "by_id" uuid NOT NULL, CONSTRAINT "PK_da7ff9aa48502d529b09cf6c126" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bd357eff8137b5fd0d71e81edd" ON "chat_mutes"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "disputes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "participant_id" uuid NOT NULL, "challenge_id" uuid NOT NULL, "user_id" uuid NOT NULL, "verification_id" uuid NOT NULL, "period" integer NOT NULL, "provider" character varying(12) NOT NULL, "reason" character varying(1000) NOT NULL, "evidence" jsonb NOT NULL DEFAULT '[]', "status" character varying(20) NOT NULL DEFAULT 'new', "priority" character varying(8) NOT NULL DEFAULT 'Normal', "due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "locked_amount" numeric(20,0) NOT NULL DEFAULT '0', "timeline" jsonb NOT NULL DEFAULT '[]', "assignee_id" uuid, "decided_by_id" uuid, "decided_at" TIMESTAMP WITH TIME ZONE, "decision_reason" character varying, "chain_open_status" character varying(10) NOT NULL DEFAULT 'none', "chain_open_sig" character varying(100), "chain_resolve_status" character varying(10) NOT NULL DEFAULT 'none', "chain_resolve_sig" character varying(100), CONSTRAINT "UQ_41268ed6ed2d1d76b8621a20cd9" UNIQUE ("participant_id", "period"), CONSTRAINT "PK_3c97580d01c1a4b0b345c42a107" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_999b614222a31412ae28625b86" ON "disputes"  ("participant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_061107f75e31ba9f0db40a44cf" ON "disputes"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22ba87431b0b09ea3e7cbd8f6b" ON "disputes"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ea46f4f2225f38d127063c367" ON "disputes"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "kind" character varying(14) NOT NULL, "title" character varying(140) NOT NULL, "body" character varying(500) NOT NULL, "href" character varying(200) NOT NULL, "read_at" TIMESTAMP WITH TIME ZONE, "dedupe_key" character varying(160), "emailed_at" TIMESTAMP WITH TIME ZONE, "pushed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e7651c9a8de8ba1b8def976b559" UNIQUE ("user_id", "dedupe_key"), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a8a82462cab47c73d25f49261" ON "notifications"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d19d2ba2fddbaca8c227048d5" ON "notifications"  ("read_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "push_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "endpoint" character varying(1000) NOT NULL, "keys" jsonb NOT NULL, CONSTRAINT "PK_757fc8f00c34f66832668dc2e53" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6771f119f1c06d2ccf38f23866" ON "push_subscriptions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0008bdfd174e533a3f98bf9af1" ON "push_subscriptions"  ("endpoint") `,
    );
    await queryRunner.query(
      `CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "slug" character varying(48) NOT NULL, "name" character varying(80) NOT NULL, "kind" character varying(16) NOT NULL DEFAULT 'Community', "about" character varying(500) NOT NULL DEFAULT '', "hue" integer NOT NULL DEFAULT '250', "avatar_url" character varying, "website" character varying, "plan" character varying(24) NOT NULL DEFAULT 'Community', "verification" character varying(12) NOT NULL DEFAULT 'pending', "verification_reason" character varying, "invite_code" character varying(24) NOT NULL, "created_by_id" uuid NOT NULL, CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_963693341bd612aa01ddf3a4b6" ON "organizations"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ddcad0daf47f7f5007287a81ee" ON "organizations"  ("invite_code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "org_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" character varying(12) NOT NULL DEFAULT 'Member', CONSTRAINT "UQ_986db88b0e82a9189921841199b" UNIQUE ("org_id", "user_id"), CONSTRAINT "PK_8391a72b91725161ab2cab00be9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a35e7519ef33c0dd4d24bb1505" ON "org_members"  ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_220d854a7932f6aac9ed84f71c" ON "org_members"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "announcements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "org_id" uuid, "challenge_id" uuid, "author_id" uuid NOT NULL, "body" character varying(2000) NOT NULL, "pinned" boolean NOT NULL DEFAULT false, "reach" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_b3ad760876ff2e19d58e05dc8b0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d79defce5bcabc69c4466da086" ON "announcements"  ("org_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09a771efee65f9ed50cddce59d" ON "announcements"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "challenge_id" uuid, "kind" character varying(24) NOT NULL, "amount" numeric(20,0) NOT NULL, "signature" character varying(100), "status" character varying(10) NOT NULL DEFAULT 'confirmed', "ref" character varying(160) NOT NULL, CONSTRAINT "PK_6efcb84411d3f08b08450ae75d5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8417854ce8bdd0d651c35e1c7c" ON "ledger_entries"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_49e8b8c71fa91b08e79c8e97d9" ON "ledger_entries"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7366fc9cbd43993bb01ec021d7" ON "ledger_entries"  ("ref") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sponsor_contributions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "challenge_id" uuid NOT NULL, "sponsor_user_id" uuid NOT NULL, "org_id" uuid, "wallet" character varying(44) NOT NULL, "amount" numeric(20,0) NOT NULL, "signature" character varying(100), "status" character varying(10) NOT NULL DEFAULT 'pending', "reclaimed" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_1976206af6971a8830cc1e00029" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4fa235ac269586bf5d2c506992" ON "sponsor_contributions"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_463b31adea3e7cf2e33ea4e006" ON "sponsor_contributions"  ("sponsor_user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "chain_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "signature" character varying(100) NOT NULL, "idx" integer NOT NULL, "slot" bigint NOT NULL, "name" character varying(32) NOT NULL, "data" jsonb NOT NULL, "processed" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_4a682d0abc5b9ca7c963a60f56b" UNIQUE ("signature", "idx"), CONSTRAINT "PK_ee3d0ef915cda84ed9b260dfc6f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4800dbedc3fadcbd85a64a3629" ON "chain_events"  ("name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "settings" ("key" character varying(64) NOT NULL, "value" jsonb NOT NULL, "updated_by_id" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c8639b7626fa94ba8265628f214" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "achievements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "challenge_id" uuid NOT NULL, "title" character varying(90) NOT NULL, "provider" character varying(12) NOT NULL, "detail" character varying(200) NOT NULL, "earned_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_97edd9fab244beeebb7099f7ff8" UNIQUE ("user_id", "challenge_id"), CONSTRAINT "PK_1bc19c37c6249f70186f318d71d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c0cd24bc6e722c12cd4575043" ON "achievements"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "reputation_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "challenge_id" uuid NOT NULL, "delta" integer NOT NULL, "reason" character varying(200) NOT NULL, "factors" jsonb NOT NULL, CONSTRAINT "UQ_a8356bb910fba73e66432bffe15" UNIQUE ("user_id", "challenge_id"), CONSTRAINT "PK_07efcf18eaa3ffa2e7a3af76cc6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_94ab262a3d671d77adaea227c0" ON "reputation_records"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "risk_signals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "kind" character varying(24) NOT NULL, "detail" character varying(300) NOT NULL, "weight" integer NOT NULL, "linked_user_id" uuid, "ref" character varying(200) NOT NULL, CONSTRAINT "PK_35e1dd1b73eb880456f17820cf4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3f1df3c448cf7ec472f3ab29a0" ON "risk_signals"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_3ec79ddfafe54ee3c62aa8498b" ON "risk_signals"  ("ref") `,
    );
    await queryRunner.query(
      `CREATE TABLE "risk_flags" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "score" integer NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'open', "signals" text array NOT NULL DEFAULT '{}', "linked_user_ids" uuid array NOT NULL DEFAULT '{}', "value" numeric(20,0) NOT NULL DEFAULT '0', "decided_by_id" uuid, "decision_reason" character varying, CONSTRAINT "PK_01362378bcc040917afecc52817" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_25fcc18b4645e5ed16d97a1d54" ON "risk_flags"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ab090204c9185e04d364e4a02" ON "risk_flags"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(320), "password_hash" character varying, "email_verified_at" TIMESTAMP WITH TIME ZONE, "name" character varying(80) NOT NULL, "handle" character varying(40) NOT NULL, "hue" integer NOT NULL DEFAULT '225', "avatar_url" character varying, "bio" character varying(280) NOT NULL DEFAULT '', "timezone" character varying(64) NOT NULL DEFAULT 'Africa/Lagos', "interests" text array NOT NULL DEFAULT '{}', "funding_preference" character varying(16), "onboarded_at" TIMESTAMP WITH TIME ZONE, "privacy" jsonb NOT NULL DEFAULT '{"profile":"public","showOnLeaderboards":true,"showConnectedAccounts":true}', "notification_prefs" jsonb NOT NULL DEFAULT '{"email":true,"push":true,"muted":[]}', "status" character varying(16) NOT NULL DEFAULT 'active', "status_reason" character varying, "score" integer NOT NULL DEFAULT '0', "admin_role" character varying(32), "totp_secret" character varying, "totp_enabled" boolean NOT NULL DEFAULT false, "signup_ip_hash" character varying(64), "device_hash" character varying(64), "last_active_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6a7e5f591436179c411f5308a9" ON "users"  ("handle") `,
    );
    await queryRunner.query(
      `CREATE TABLE "connected_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "provider" character varying(24) NOT NULL, "external_id" character varying NOT NULL, "username" character varying NOT NULL, "access_token" text, "refresh_token" text, "token_expires_at" TIMESTAMP WITH TIME ZONE, "scopes" character varying NOT NULL DEFAULT '', "external_created_at" TIMESTAMP WITH TIME ZONE, "status" character varying(20) NOT NULL DEFAULT 'active', CONSTRAINT "UQ_50cccbeff7eb4ccf2d5952df8d3" UNIQUE ("user_id", "provider"), CONSTRAINT "UQ_9d676f26a19bc2c736118a41348" UNIQUE ("provider", "external_id"), CONSTRAINT "PK_70416f1da0be645bb31da01c774" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "address" character varying(44) NOT NULL, "kind" character varying(10) NOT NULL, "primary" boolean NOT NULL DEFAULT false, "verified_at" TIMESTAMP WITH TIME ZONE, "funded_by" character varying(44), "rent_drips_today" integer NOT NULL DEFAULT '0', "rent_drip_day" character varying(10), CONSTRAINT "PK_8402e5df5a30a229380e83e4f7e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92558c08091598f7a4439586cd" ON "wallets"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f907d5fd09a9d374f1da4e13bd" ON "wallets"  ("address") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_50d99f74c62af9699dfea91ef0" ON "wallets"  ("funded_by") `,
    );
    await queryRunner.query(
      `CREATE TABLE "verifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "participant_id" uuid NOT NULL, "challenge_id" uuid NOT NULL, "user_id" uuid NOT NULL, "period" integer NOT NULL, "state" character varying(12) NOT NULL DEFAULT 'pending', "provider" character varying(12) NOT NULL, "detail" character varying(300) NOT NULL DEFAULT '', "evidence" jsonb NOT NULL DEFAULT '{}', "units" integer NOT NULL DEFAULT '0', "attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE, "first_unavailable_at" TIMESTAMP WITH TIME ZONE, "decided_at" TIMESTAMP WITH TIME ZONE, "chain_outcome" character varying(10), "chain_status" character varying(10) NOT NULL DEFAULT 'none', "chain_sig" character varying(100), "chain_error" character varying, CONSTRAINT "UQ_90115a693d46121677d9a64c7cb" UNIQUE ("participant_id", "period"), CONSTRAINT "PK_2127ad1b143cf012280390b01d1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f378b23c738475b3a51938e0ff" ON "verifications"  ("participant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a39cb717d0f2172137c680c25" ON "verifications"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e9a134af366776c65116891661" ON "verifications"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2d58628881a8506a9b7b269a07" ON "verifications"  ("state") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_556f282ab71521aec14e3bac2f" ON "verifications"  ("next_attempt_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47289524cd7c23ce2fe039a884" ON "verifications"  ("chain_status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "proof_submissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "participant_id" uuid NOT NULL, "challenge_id" uuid NOT NULL, "period" integer NOT NULL, "kind" character varying(8) NOT NULL, "file_key" character varying, "note" character varying(500) NOT NULL DEFAULT '', "value" integer, "duration_sec" integer, "payload" jsonb NOT NULL DEFAULT '{}', "phash" character varying(16), "taken_at" TIMESTAMP WITH TIME ZONE, "flags" text array NOT NULL DEFAULT '{}', "status" character varying(16) NOT NULL DEFAULT 'pending_review', "reviewed_by_id" uuid, "reviewed_at" TIMESTAMP WITH TIME ZONE, "review_reason" character varying, CONSTRAINT "PK_90d6d9ac920f169db9c2d8c1b32" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c79df9cd5b5faf547ac733b709" ON "proof_submissions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0e652240efaae5a3fba3736862" ON "proof_submissions"  ("participant_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f8f04c9447d0cad86f098f181b" ON "proof_submissions"  ("challenge_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_036b6deba56407b02beb093a3b" ON "proof_submissions"  ("phash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_28a3d246913688c20338d4da17" ON "proof_submissions"  ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "provider_incidents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "provider" character varying(12) NOT NULL, "status" character varying(10) NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ends_at" TIMESTAMP WITH TIME ZONE, "reason" character varying(500) NOT NULL, "declared_by_id" uuid, "protected_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_28a35e4bdc4df53aaf3215786cf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2194be4dc70cefb0f0ccdc9f07" ON "provider_incidents"  ("provider") `,
    );
    await queryRunner.query(
      `ALTER TABLE "participants" ADD CONSTRAINT "FK_21b7c0286ecb8cb7b4ac865ff1d" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "connected_accounts" ADD CONSTRAINT "FK_f47244225a6a1eac04a3463dd90" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD CONSTRAINT "FK_92558c08091598f7a4439586cda" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "FK_92558c08091598f7a4439586cda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "connected_accounts" DROP CONSTRAINT "FK_f47244225a6a1eac04a3463dd90"`,
    );
    await queryRunner.query(
      `ALTER TABLE "participants" DROP CONSTRAINT "FK_21b7c0286ecb8cb7b4ac865ff1d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2194be4dc70cefb0f0ccdc9f07"`,
    );
    await queryRunner.query(`DROP TABLE "provider_incidents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_28a3d246913688c20338d4da17"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_036b6deba56407b02beb093a3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f8f04c9447d0cad86f098f181b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0e652240efaae5a3fba3736862"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c79df9cd5b5faf547ac733b709"`,
    );
    await queryRunner.query(`DROP TABLE "proof_submissions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47289524cd7c23ce2fe039a884"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_556f282ab71521aec14e3bac2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2d58628881a8506a9b7b269a07"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e9a134af366776c65116891661"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a39cb717d0f2172137c680c25"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f378b23c738475b3a51938e0ff"`,
    );
    await queryRunner.query(`DROP TABLE "verifications"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_50d99f74c62af9699dfea91ef0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f907d5fd09a9d374f1da4e13bd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92558c08091598f7a4439586cd"`,
    );
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP TABLE "connected_accounts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a7e5f591436179c411f5308a9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1ab090204c9185e04d364e4a02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_25fcc18b4645e5ed16d97a1d54"`,
    );
    await queryRunner.query(`DROP TABLE "risk_flags"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3ec79ddfafe54ee3c62aa8498b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3f1df3c448cf7ec472f3ab29a0"`,
    );
    await queryRunner.query(`DROP TABLE "risk_signals"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_94ab262a3d671d77adaea227c0"`,
    );
    await queryRunner.query(`DROP TABLE "reputation_records"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c0cd24bc6e722c12cd4575043"`,
    );
    await queryRunner.query(`DROP TABLE "achievements"`);
    await queryRunner.query(`DROP TABLE "settings"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4800dbedc3fadcbd85a64a3629"`,
    );
    await queryRunner.query(`DROP TABLE "chain_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_463b31adea3e7cf2e33ea4e006"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fa235ac269586bf5d2c506992"`,
    );
    await queryRunner.query(`DROP TABLE "sponsor_contributions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7366fc9cbd43993bb01ec021d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_49e8b8c71fa91b08e79c8e97d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8417854ce8bdd0d651c35e1c7c"`,
    );
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09a771efee65f9ed50cddce59d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d79defce5bcabc69c4466da086"`,
    );
    await queryRunner.query(`DROP TABLE "announcements"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_220d854a7932f6aac9ed84f71c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a35e7519ef33c0dd4d24bb1505"`,
    );
    await queryRunner.query(`DROP TABLE "org_members"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ddcad0daf47f7f5007287a81ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_963693341bd612aa01ddf3a4b6"`,
    );
    await queryRunner.query(`DROP TABLE "organizations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0008bdfd174e533a3f98bf9af1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6771f119f1c06d2ccf38f23866"`,
    );
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d19d2ba2fddbaca8c227048d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a8a82462cab47c73d25f49261"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ea46f4f2225f38d127063c367"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_22ba87431b0b09ea3e7cbd8f6b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_061107f75e31ba9f0db40a44cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_999b614222a31412ae28625b86"`,
    );
    await queryRunner.query(`DROP TABLE "disputes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bd357eff8137b5fd0d71e81edd"`,
    );
    await queryRunner.query(`DROP TABLE "chat_mutes"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3fa0511636849325444b6e2dc6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_afe6bda0d38f090210d1ee0ea4"`,
    );
    await queryRunner.query(`DROP TABLE "feed_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dab4d78b3be05c1ca4a626f57f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55e740bb1b43f8350bfeb0b3ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8401422324e7fa80304ed708e0"`,
    );
    await queryRunner.query(`DROP TABLE "reports"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2ee227780745018b358237c0ad"`,
    );
    await queryRunner.query(`DROP TABLE "reactions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_05535bc695e9f7ee104616459d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76ada20bdf1d48bc8c38a97d45"`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1427a77e06023c250ed3794a1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_21b7c0286ecb8cb7b4ac865ff1"`,
    );
    await queryRunner.query(`DROP TABLE "participants"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ee2b5324ac2014fa210d81c1b"`,
    );
    await queryRunner.query(`DROP TABLE "challenge_rules"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9fe7ac09a95d392ea777691c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c2c432d50b1ea7990e911a621"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f18516fd67deb6c0d28a3f51db"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_677a12a7d3b4d8bef12e44c728"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52f05c24d1184061261f0c82a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_700e063e7f395178eab9a6d1db"`,
    );
    await queryRunner.query(`DROP TABLE "challenges"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a94cfa1eada85ac2bf6f3016b"`,
    );
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0be384894b8949610f7915d19b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_085d540d9f418cfbdc7bd55bb1"`,
    );
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0b9522f4648b5b18f28ba6a9ae"`,
    );
    await queryRunner.query(`DROP TABLE "approvals"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7064857330342779b2bbd4584c"`,
    );
    await queryRunner.query(`DROP TABLE "audit_entries"`);
  }
}
