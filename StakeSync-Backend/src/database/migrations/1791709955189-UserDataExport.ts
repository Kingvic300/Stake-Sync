import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserDataExport1791709955189 implements MigrationInterface {
  name = 'UserDataExport1791709955189';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "data_exported_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "data_exported_at"`,
    );
  }
}
