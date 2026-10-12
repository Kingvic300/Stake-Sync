import { assertSafeEnv } from './validate-env.js';

const safe = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(40),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  DATABASE_URL: 'postgresql://db/stakesync',
  CORS_ORIGINS: 'https://app.stakesync.app',
  APP_URL: 'https://app.stakesync.app',
};

describe('production configuration', () => {
  it('starts without any Onramper webhook settings (the widget links work alone)', () => {
    expect(() => assertSafeEnv({ ...safe, ONRAMPER_API_KEY: 'pk_prod_x', ONRAMPER_SIGNING_KEY: 'pem' })).not.toThrow();
  });

  it('needs the webhook secret only once webhooks are turned on', () => {
    expect(() => assertSafeEnv({ ...safe, ONRAMPER_WEBHOOKS_ENABLED: 'true' })).toThrow(/ONRAMPER_WEBHOOK_SECRET/);
    expect(() => assertSafeEnv({ ...safe, ONRAMPER_WEBHOOKS_ENABLED: 'true', ONRAMPER_WEBHOOK_SECRET: '  ' })).toThrow(/ONRAMPER_WEBHOOK_SECRET/);
    expect(() => assertSafeEnv({ ...safe, ONRAMPER_WEBHOOKS_ENABLED: 'true', ONRAMPER_WEBHOOK_SECRET: 'secret' })).not.toThrow();
  });

  it('refuses sell webhooks or reconciliation without webhooks, and reconciliation without an API key', () => {
    expect(() => assertSafeEnv({ ...safe, ONRAMPER_SELL_WEBHOOKS_ENABLED: 'true' })).toThrow(/ONRAMPER_WEBHOOKS_ENABLED/);
    const on = { ...safe, ONRAMPER_WEBHOOKS_ENABLED: 'true', ONRAMPER_WEBHOOK_SECRET: 'secret' };
    expect(() => assertSafeEnv({ ...on, ONRAMPER_RECONCILE_ENABLED: 'true' })).toThrow(/ONRAMPER_API_KEY/);
    expect(() => assertSafeEnv({ ...on, ONRAMPER_RECONCILE_ENABLED: 'true', ONRAMPER_API_KEY: 'pk_prod_x' })).not.toThrow();
  });
});
