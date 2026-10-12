import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FeesAndTerms1791546238189 implements MigrationInterface {
  name = 'FeesAndTerms1791546238189';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD "join_fee_bps" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" ADD "creator_agreed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "participants" ADD "join_fee" numeric(20,0) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "terms_accepted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "terms_version" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "terms_version"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "terms_accepted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "participants" DROP COLUMN "join_fee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN "creator_agreed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "challenges" DROP COLUMN "join_fee_bps"`,
    );
  }
}
