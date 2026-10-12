/**
 * Refuses to start in production with unsafe settings, so a missing secret is caught at deploy
 * time instead of by an attacker.
 */
export function assertSafeEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  const need = (k: string, ok: boolean, why: string) => ok || problems.push(`${k}: ${why}`);
  need('JWT_SECRET', (env.JWT_SECRET ?? '').length >= 32 && env.JWT_SECRET !== 'dev-only-change-me', 'set a random secret of at least 32 characters');
  need('ENCRYPTION_KEY', Buffer.from(env.ENCRYPTION_KEY ?? '', 'base64').length === 32, 'set a base64 32-byte key');
  need('DATABASE_URL', Boolean(env.DATABASE_URL), 'required');
  need('DB_SYNC', env.DB_SYNC !== 'true', 'must be off in production; use migrations');
  need('CORS_ORIGINS', Boolean(env.CORS_ORIGINS) && !env.CORS_ORIGINS!.includes('*') && !/localhost/.test(env.CORS_ORIGINS!), 'list your real app origins (no *, no localhost)');
  need('APP_URL', (env.APP_URL ?? '').startsWith('https://'), 'must be https');
  // Only needed once webhooks are switched on; the widget links work without them.
  if (env.ONRAMPER_WEBHOOKS_ENABLED === 'true') {
    need('ONRAMPER_WEBHOOK_SECRET', Boolean(env.ONRAMPER_WEBHOOK_SECRET?.trim()), 'required when ONRAMPER_WEBHOOKS_ENABLED=true (Onramper issues it when the webhook is registered)');
  }
  if (env.ONRAMPER_RECONCILE_ENABLED === 'true' || env.ONRAMPER_SELL_WEBHOOKS_ENABLED === 'true') {
    need('ONRAMPER_WEBHOOKS_ENABLED', env.ONRAMPER_WEBHOOKS_ENABLED === 'true', 'reconciliation and sell webhooks need webhooks turned on');
  }
  if (env.ONRAMPER_RECONCILE_ENABLED === 'true') {
    need('ONRAMPER_API_KEY', Boolean(env.ONRAMPER_API_KEY?.trim()), 'reconciliation calls Onramper’s API with it');
  }
  if (problems.length) {
    throw new Error(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
  }
}
