import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, randomBytes, scrypt, timingSafeEqual, verify } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest();
export const sha256Hex = (data: string | Buffer) => sha256(data).toString('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Short, unambiguous code for invites and references (no 0/O/1/I). */
export function randomCode(len = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** AES-256-GCM. Output: iv.tag.ciphertext, base64url. */
export function encrypt(plain: string | Buffer, keyB64: string) {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string, keyB64: string) {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for admin two-factor.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function verifyTotp(secretB32: string, code: string, now = Date.now()) {
  return totpStep(secretB32, code, now) !== null;
}

/** The current code for a secret (used by tests and setup checks). */
export function totpCode(secretB32: string, now = Date.now()) {
  return hotp(base32Decode(secretB32), Math.floor(now / 30_000));
}

/** The matching time step (±30 s of clock drift), or null. Store it to stop the same code being reused. */
export function totpStep(secretB32: string, code: string, now = Date.now()) {
  const secret = base32Decode(secretB32);
  const step = Math.floor(now / 30_000);
  for (const d of [-1, 0, 1]) if (safeEqual(hotp(secret, step + d), code.trim())) return step + d;
  return null;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Verifies a Solana wallet's signMessage signature. */
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array) {
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]), format: 'der', type: 'spki' });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}
