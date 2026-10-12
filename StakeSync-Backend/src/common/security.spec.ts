import { createHmac, randomBytes } from 'node:crypto';
import { redact, redactUrl } from '../core/logs/redact.js';
import { sanitizeVerificationConfig } from '../modules/challenges/verification-config.js';
import { safeRedirect } from '../modules/auth/auth.service.js';
import { base32Encode, totpStep } from './crypto.js';
import { assertStrongPassword } from './password-policy.js';

describe('security helpers', () => {
  it('only allows same-site redirects after OAuth', () => {
    expect(safeRedirect('/wallet?tab=claims')).toBe('/wallet?tab=claims');
    expect(safeRedirect('//evil.com')).toBe('/');
    expect(safeRedirect('/\\evil.com')).toBe('/');
    expect(safeRedirect('https://evil.com')).toBe('/');
    expect(safeRedirect('/javascript:alert(1)')).toBe('/'); // odd characters are refused outright
    expect(safeRedirect(undefined)).toBe('/');
  });

  it('rejects weak passwords and accepts reasonable ones', () => {
    expect(() => assertStrongPassword('password123')).toThrow();
    expect(() => assertStrongPassword('aaaaaaaaaa')).toThrow();
    expect(() => assertStrongPassword('short')).toThrow();
    expect(() => assertStrongPassword('ladipo2026!', 'ladipo@example.com')).toThrow();
    expect(() => assertStrongPassword('correct horse battery', 'ladipo@example.com')).not.toThrow();
  });

  it('never stores secrets in logs', () => {
    expect(redact({ email: 'a@b.c', password: 'x', nested: { refreshToken: 'y', ok: 1 }, list: [{ apiKey: 'z' }] })).toEqual({
      email: 'a@b.c',
      password: '[redacted]',
      nested: { refreshToken: '[redacted]', ok: 1 },
      list: [{ apiKey: '[redacted]' }],
    });
    expect(redactUrl('/api/auth/oauth/github/callback?code=abc&state=def&mode=connect')).toBe('/api/auth/oauth/github/callback?code=%5Bredacted%5D&state=%5Bredacted%5D&mode=connect');
  });

  it('keeps only known, valid verification settings', () => {
    expect(sanitizeVerificationConfig({ github: { repo: 'owner/name', minChangedLines: 10, evil: '<script>' }, junk: { a: 1 } })).toEqual({
      github: { repo: 'owner/name', minChangedLines: 10 },
    });
    expect(() => sanitizeVerificationConfig({ github: { repo: '../../users/x' } })).toThrow();
    expect(() => sanitizeVerificationConfig({ github: { repo: 'a/../b' } })).toThrow();
    expect(() => sanitizeVerificationConfig({ camera: { reps: 1e9 } })).toThrow();
    expect(() => sanitizeVerificationConfig({ solana: { activity: 'program', programId: 'not-an-address' } })).toThrow();
  });

  it('identifies the TOTP step so a code can only be used once', () => {
    const secret = randomBytes(20);
    const now = 1_790_000_000_000;
    const step = Math.floor(now / 30_000);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac('sha1', secret).update(msg).digest();
    const code = ((h.readUInt32BE(h[h.length - 1] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
    expect(totpStep(base32Encode(secret), code, now)).toBe(step);
  });
});
