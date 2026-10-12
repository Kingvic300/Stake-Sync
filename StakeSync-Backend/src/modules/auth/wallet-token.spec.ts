import { ConfigService } from '@nestjs/config';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { WalletTokenService } from './wallet-token.service.js';

describe('WalletTokenService', () => {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const svc = new WalletTokenService(new ConfigService({ walletAuth: { privateKey: pem.replace(/\n/g, '\\n') } }));

  it('issues ES256 tokens that verify against the published JWKS', () => {
    const { token } = svc.issue('user-1');
    const [h, p, s] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    const jwk = svc.jwks().keys[0];
    expect(header).toMatchObject({ alg: 'ES256', kid: jwk.kid });
    expect(payload).toMatchObject({ sub: 'user-1', iss: 'stakesync' });
    expect(payload.exp - payload.iat).toBe(600);
    const key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('refuses keys that are not P-256', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(() => new WalletTokenService(new ConfigService({ walletAuth: { privateKey: rsa } }))).toThrow(/P-256/);
  });
});
