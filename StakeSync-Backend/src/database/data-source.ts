// Used by the TypeORM CLI (after npm run build): npm run migration:generate -- src/database/migrations/Name
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';
import { SnakeNamingStrategy } from './naming.strategy.js';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: rely on the environment
}

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  namingStrategy: new SnakeNamingStrategy(),
  migrations: MIGRATIONS,
});
