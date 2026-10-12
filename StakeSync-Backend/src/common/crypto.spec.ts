import { base32Encode, decrypt, encrypt, hashPassword, verifyPassword, verifyTotp } from './crypto.js';
import { createHmac, randomBytes } from 'node:crypto';

describe('crypto helpers', () => {
  it('hashes and checks passwords', async () => {
    const h = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('round-trips AES-GCM and rejects tampering', () => {
    const key = randomBytes(32).toString('base64');
    const sealed = encrypt('secret token', key);
    expect(decrypt(sealed, key).toString()).toBe('secret token');
    const [iv, tag, data] = sealed.split('.');
    expect(() => decrypt([iv, tag, data.slice(0, -2) + 'AA'].join('.'), key)).toThrow();
  });

  it('accepts the current TOTP code (RFC 6238)', () => {
    const secret = randomBytes(20);
    const now = 1_790_000_000_000;
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
    const h = createHmac('sha1', secret).update(msg).digest();
    const off = h[h.length - 1] & 15;
    const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
    expect(verifyTotp(base32Encode(secret), code, now)).toBe(true);
    expect(verifyTotp(base32Encode(secret), code === '000000' ? '111111' : '000000', now)).toBe(false);
  });
});
