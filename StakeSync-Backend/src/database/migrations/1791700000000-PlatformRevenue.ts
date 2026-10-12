import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformRevenue1791700000000 implements MigrationInterface {
  name = 'PlatformRevenue1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "challenges" ADD "platform_revenue" numeric(20,0)`);
    await queryRunner.query(`ALTER TABLE "challenges" ADD "platform_join_fees" numeric(20,0)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "challenges" DROP COLUMN "platform_join_fees"`);
    await queryRunner.query(`ALTER TABLE "challenges" DROP COLUMN "platform_revenue"`);
  }
}
