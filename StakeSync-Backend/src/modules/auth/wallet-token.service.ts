import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/**
 * Short-lived ES256 tokens that let the embedded-wallet provider (Privy) trust our sign-in, so
 * people get a wallet without logging in twice. Privy checks them against our public key (JWKS).
 * They can't be used with our own API, which only accepts its HS256 session tokens.
 */
@Injectable()
export class WalletTokenService {
  private readonly key: KeyObject;
  private readonly kid: string;
  private readonly ttlSecs = 10 * 60;

  constructor(config: ConfigService) {
    const pem = config.get<string>('walletAuth.privateKey');
    if (pem) {
      // Accepts the PEM as-is or with literal "\n" (handy in .env files).
      this.key = createPrivateKey(pem.replace(/\\n/g, '\n'));
    } else {
      new Logger('WalletToken').warn('WALLET_AUTH_PRIVATE_KEY missing: using a temporary key, so embedded-wallet sign-in breaks after every restart.');
      this.key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    }
    if (this.key.asymmetricKeyType !== 'ec' || this.key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('WALLET_AUTH_PRIVATE_KEY must be an EC P-256 (ES256) private key');
    }
    this.kid = createHash('sha256').update(this.publicJwk().x + this.publicJwk().y).digest('base64url').slice(0, 16);
  }

  private publicJwk() {
    return createPublicKey(this.key).export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
  }

  /** What Privy fetches to verify our tokens. */
  jwks() {
    const { kty, crv, x, y } = this.publicJwk();
    return { keys: [{ kty, crv, x, y, kid: this.kid, alg: 'ES256', use: 'sig' }] };
  }

  issue(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: this.kid }));
    const payload = b64url(JSON.stringify({ sub: userId, iss: 'stakesync', aud: 'stakesync-wallets', iat: now, exp: now + this.ttlSecs }));
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: this.key, dsaEncoding: 'ieee-p1363' });
    return { token: `${header}.${payload}.${b64url(signature)}`, expiresIn: this.ttlSecs };
  }
}
