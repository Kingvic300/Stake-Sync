import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt } from '../common/crypto.js';

/** Encryption at rest for OAuth tokens and admin TOTP secrets (PRD §30). */
@Injectable()
export class CryptoService {
  private readonly key: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('encryptionKey');
    if (key && Buffer.from(key, 'base64').length === 32) {
      this.key = key;
    } else {
      if (config.get('env') === 'production') throw new Error('ENCRYPTION_KEY must be a base64 32-byte key in production');
      new Logger('Crypto').warn('ENCRYPTION_KEY missing: using a temporary key. Encrypted data will not survive a restart.');
      this.key = randomBytes(32).toString('base64');
    }
  }

  seal(plain: string | Buffer) {
    return encrypt(plain, this.key);
  }

  open(sealed: string) {
    return decrypt(sealed, this.key);
  }

  openText(sealed: string) {
    return this.open(sealed).toString('utf8');
  }
}
