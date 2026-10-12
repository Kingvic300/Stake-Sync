import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors.js';
import { fetchJson } from '../../common/http.js';

export type OAuthProvider = 'google' | 'github' | 'wakatime';

export interface OAuthProfile {
  provider: OAuthProvider;
  externalId: string;
  username: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: Date | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string;
}

/** All three have free developer access: Google Cloud OAuth, GitHub OAuth apps, WakaTime apps. */
const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
  wakatime: {
    authorize: 'https://wakatime.com/oauth/authorize',
    token: 'https://wakatime.com/oauth/token',
    scope: 'read_summaries',
  },
} as const;

const LABELS: Record<OAuthProvider, string> = { google: 'Google', github: 'GitHub', wakatime: 'WakaTime' };

@Injectable()
export class OAuthService {
  constructor(private readonly config: ConfigService) {}

  private creds(p: OAuthProvider) {
    const c = this.config.get<{ clientId?: string; clientSecret?: string }>(`oauth.${p}`);
    if (!c?.clientId || !c.clientSecret) throw new AppError('provider_not_configured', `${LABELS[p]} isn't available right now. Please try again later.`, 503);
    return c as { clientId: string; clientSecret: string };
  }

  redirectUri(p: OAuthProvider) {
    return `${this.config.get('appUrl')}/auth/callback/${p}`;
  }

  authorizeUrl(p: OAuthProvider, state: string) {
    const { clientId } = this.creds(p);
    const url = new URL(PROVIDERS[p].authorize);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(p));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', PROVIDERS[p].scope);
    url.searchParams.set('state', state);
    if (p === 'google') url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  async exchange(p: OAuthProvider, code: string): Promise<OAuthProfile> {
    const { clientId, clientSecret } = this.creds(p);
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: this.redirectUri(p),
      grant_type: 'authorization_code',
    });
    const token = await fetchJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }>(PROVIDERS[p].token, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      provider: p,
    });
    if (!token.access_token) throw new AppError('oauth_failed', 'That sign-in link expired. Please try again.');
    const base = {
      provider: p,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      scopes: token.scope ?? PROVIDERS[p].scope,
    };
    return { ...base, ...(await this.profile(p, token.access_token)) };
  }

  private async profile(p: OAuthProvider, accessToken: string) {
    const auth = { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Stake-Sync' };
    if (p === 'google') {
      const u = await fetchJson<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: auth, provider: p },
      );
      return { externalId: u.sub, username: u.email ?? u.sub, name: u.name ?? 'New member', email: u.email ?? null, emailVerified: Boolean(u.email_verified), avatarUrl: u.picture ?? null, createdAt: null };
    }
    if (p === 'github') {
      const u = await fetchJson<{ id: number; login: string; name: string | null; avatar_url: string; created_at: string }>('https://api.github.com/user', { headers: auth, provider: p });
      const emails = await fetchJson<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', { headers: auth, provider: p }).catch(() => []);
      const primary = emails.find((e) => e.primary && e.verified);
      return {
        externalId: String(u.id),
        username: u.login,
        name: u.name ?? u.login,
        email: primary?.email ?? null,
        emailVerified: Boolean(primary),
        avatarUrl: u.avatar_url,
        createdAt: new Date(u.created_at),
      };
    }
    const u = await fetchJson<{ data: { id: string; username: string | null; display_name: string; email: string | null; photo: string; created_at: string } }>(
      'https://wakatime.com/api/v1/users/current',
      { headers: auth, provider: p },
    );
    return {
      externalId: u.data.id,
      username: u.data.username ?? u.data.display_name,
      name: u.data.display_name,
      email: u.data.email,
      emailVerified: false,
      avatarUrl: u.data.photo,
      createdAt: new Date(u.data.created_at),
    };
  }

  /** WakaTime tokens expire; refresh before use. */
  async refresh(p: OAuthProvider, refreshToken: string) {
    const { clientId, clientSecret } = this.creds(p);
    const token = await fetchJson<{ access_token: string; refresh_token?: string; expires_in?: number }>(PROVIDERS[p].token, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', redirect_uri: this.redirectUri(p) }),
      provider: p,
    });
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    };
  }
}
