import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OAuthService } from './oauth.service.js';
import { WalletTokenService } from './wallet-token.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('auth.jwtSecret')!;
        if (config.get('env') === 'production' && secret === 'dev-only-change-me') throw new Error('Set JWT_SECRET in production');
        return { secret, signOptions: { issuer: 'stakesync' }, verifyOptions: { issuer: 'stakesync' } };
      },
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OAuthService, WalletTokenService],
  exports: [AuthService, OAuthService],
})
export class AuthModule {}
