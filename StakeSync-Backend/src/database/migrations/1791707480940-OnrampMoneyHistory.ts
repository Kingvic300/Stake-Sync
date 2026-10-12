import type { MigrationInterface, QueryRunner } from 'typeorm';

export class OnrampMoneyHistory1791707480940 implements MigrationInterface {
  name = 'OnrampMoneyHistory1791707480940';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "onramp_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" uuid NOT NULL, "wallet_address" character varying(44) NOT NULL, "mode" character varying(4) NOT NULL, "partner_context" character varying(64) NOT NULL, "fiat_currency" character varying(10), "requested_amount" numeric(24,8), CONSTRAINT "PK_f5f18df094f1b21ccba2f2951c3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ee6793306ea035e36f7ffef17a" ON "onramp_sessions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4fc0491bd9acd53d5699b9adac" ON "onramp_sessions"  ("partner_context") `,
    );
    await queryRunner.query(
      `CREATE TABLE "onramp_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "transaction_id" character varying(64) NOT NULL, "session_id" uuid, "user_id" uuid, "direction" character varying(4) NOT NULL, "provider" character varying(40), "provider_transaction_id" character varying(120), "provider_status" character varying(24) NOT NULL, "state" character varying(12) NOT NULL, "status_date" TIMESTAMP WITH TIME ZONE NOT NULL, "progress" smallint NOT NULL DEFAULT '0', "usdc_amount" numeric(20,0), "fiat_amount" numeric(24,8), "fiat_currency" character varying(10), "wallet_address" character varying(64), "transaction_hash" character varying(128), "chain_verified" boolean NOT NULL DEFAULT false, "status_reason" character varying(300), "ledger_entry_id" uuid, "notified_state" character varying(12), "review_reason" character varying(200), CONSTRAINT "PK_a47f594755e46cc2a8e0f69fa6d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_833c7a7957f2c56f8eee85d2ee" ON "onramp_transactions"  ("transaction_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_634b16e6055b247d4ee323c58d" ON "onramp_transactions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "onramp_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "transaction_id" character varying(64), "source" character varying(8) NOT NULL, "body_sha256" character(64) NOT NULL, "payload" jsonb, "status" character varying(24), "status_date" TIMESTAMP WITH TIME ZONE, "processed_at" TIMESTAMP WITH TIME ZONE, "outcome" character varying(10), "note" character varying(300), "attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE, "last_error" character varying(300), CONSTRAINT "PK_9fad567dd33fb835e5bd8a74f47" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6fbd12de727201e68e5b4476f" ON "onramp_events"  ("transaction_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e1c9cdac881afb16f1c9077292" ON "onramp_events"  ("body_sha256") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90a9fc065e51e1c4a8821752a3" ON "onramp_events"  ("processed_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "fiat_amount" numeric(24,8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "fiat_currency" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "detail" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD "external_ref" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "external_ref"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "detail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "fiat_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP COLUMN "fiat_amount"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90a9fc065e51e1c4a8821752a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1c9cdac881afb16f1c9077292"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6fbd12de727201e68e5b4476f"`,
    );
    await queryRunner.query(`DROP TABLE "onramp_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_634b16e6055b247d4ee323c58d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_833c7a7957f2c56f8eee85d2ee"`,
    );
    await queryRunner.query(`DROP TABLE "onramp_transactions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fc0491bd9acd53d5699b9adac"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ee6793306ea035e36f7ffef17a"`,
    );
    await queryRunner.query(`DROP TABLE "onramp_sessions"`);
  }
}
