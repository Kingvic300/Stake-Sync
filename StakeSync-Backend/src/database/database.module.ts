import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './entities.js';
import { MIGRATIONS } from './migrations/index.js';
import { SnakeNamingStrategy } from './naming.strategy.js';

/** Connection plus every repository, available to all modules. */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('database.url'),
        entities: ENTITIES,
        namingStrategy: new SnakeNamingStrategy(),
        // Schema changes go through migrations. DB_SYNC=true is for throwaway local databases only.
        synchronize: config.get<boolean>('database.sync') ?? false,
        migrations: MIGRATIONS,
        migrationsRun: !config.get<boolean>('database.sync'),
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
