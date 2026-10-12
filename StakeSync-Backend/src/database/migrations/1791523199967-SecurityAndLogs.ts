import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SecurityAndLogs1791523199967 implements MigrationInterface {
  name = 'SecurityAndLogs1791523199967';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "server_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "level" character varying(5) NOT NULL, "kind" character varying(8) NOT NULL, "context" character varying(60) NOT NULL DEFAULT '', "message" character varying(1000) NOT NULL, "request_id" character varying(36), "method" character varying(8), "path" character varying(500), "status" integer, "duration_ms" integer, "user_id" uuid, "ip" character varying(64), "user_agent" character varying(300), "meta" jsonb NOT NULL DEFAULT '{}', "error_group_id" uuid, "stack" text, CONSTRAINT "PK_6b90d6746c1d17cd1466f9941a5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_baefcfa0f91e0363ab61ca93b5" ON "server_logs"  ("level") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13c4bd7be67ad3fb96f0cf0714" ON "server_logs"  ("kind") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_195d6855ea3be39015b5cd0d09" ON "server_logs"  ("request_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31521ac81a3d0b408582ab0fc2" ON "server_logs"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_637d0316c4e6d24908c89c6284" ON "server_logs"  ("error_group_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c21fd676f0f3244c545162dd8c" ON "server_logs"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "error_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fingerprint" character varying(64) NOT NULL, "message" character varying(1000) NOT NULL, "context" character varying(60) NOT NULL DEFAULT '', "where" character varying(500), "count" integer NOT NULL DEFAULT '1', "first_seen" TIMESTAMP WITH TIME ZONE NOT NULL, "last_seen" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'open', "resolved_by_id" uuid, "resolved_at" TIMESTAMP WITH TIME ZONE, "resolution" character varying(500), "sample_stack" text, "last_request_id" character varying(36), CONSTRAINT "PK_75f3d2ade79d16975fb3b39352c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d8a1adf467f843f858c925bdb8" ON "error_groups"  ("fingerprint") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea3f89a9806f74d5083c9e042f" ON "error_groups"  ("last_seen") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24119d30a6bdd000408475bfbe" ON "error_groups"  ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "mfa" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "totp_last_step" integer`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "failed_logins" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "locked_until" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locked_until"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "failed_logins"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "totp_last_step"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "mfa"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24119d30a6bdd000408475bfbe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea3f89a9806f74d5083c9e042f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8a1adf467f843f858c925bdb8"`,
    );
    await queryRunner.query(`DROP TABLE "error_groups"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c21fd676f0f3244c545162dd8c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_637d0316c4e6d24908c89c6284"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31521ac81a3d0b408582ab0fc2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_195d6855ea3be39015b5cd0d09"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13c4bd7be67ad3fb96f0cf0714"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_baefcfa0f91e0363ab61ca93b5"`,
    );
    await queryRunner.query(`DROP TABLE "server_logs"`);
  }
}
