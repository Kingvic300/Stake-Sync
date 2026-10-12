import { AppError } from './errors.js';

// The most common passwords from public breach lists. Long enough to stop the obvious guesses.
const COMMON = new Set(
  `password password1 password123 12345678 123456789 1234567890 qwerty123 qwertyuiop 11111111 00000000 iloveyou
   abc12345 football baseball welcome1 welcome123 admin123 letmein1 sunshine princess dragon123 monkey123 trustno1
   passw0rd p@ssw0rd p@ssword 1q2w3e4r 1qaz2wsx zaq12wsx asdfghjk asdf1234 qwerty12 superman batman123 master123
   changeme starwars whatever freedom1 michael1 shadow12 football1 jesus123 lagos123 nigeria1 naija123 stakesync`
    .split(/\s+/)
    .filter(Boolean),
);

/** Length plus a breach-list check; no arbitrary symbol rules (NIST SP 800-63B). */
export function assertStrongPassword(password: string, email?: string | null) {
  const p = password.toLowerCase();
  if (password.length < 8) throw new AppError('weak_password', 'Use at least 8 characters for your password.');
  if (COMMON.has(p) || /^(.)\1+$/.test(password) || /^(0123456789|123456789|abcdefgh)/.test(p)) {
    throw new AppError('weak_password', 'That password is too common. Try a longer phrase only you would think of.');
  }
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && p.includes(local)) throw new AppError('weak_password', 'Don’t use your email address in your password.');
}
