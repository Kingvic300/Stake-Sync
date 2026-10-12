import type { ConfigService } from '@nestjs/config';
import { OnrampWebhookService } from './onramp-webhook.service.js';

const service = (values: Record<string, unknown>) => {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  const unused = null as never;
  return new OnrampWebhookService(unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, config);
};

describe('Onramper webhook gate', () => {
  it('refuses webhooks while they are switched off, without touching anything', async () => {
    await expect(service({}).receive(Buffer.from('{}'), 'sig', {})).rejects.toMatchObject({ code: 'onramp_webhooks_disabled', status: 503 });
  });

  it('refuses webhooks when switched on without a secret, rather than accepting unsigned ones', async () => {
    await expect(service({ 'onramp.webhooksEnabled': true, 'onramp.webhookSecret': '  ' }).receive(Buffer.from('{}'), 'sig', {})).rejects.toMatchObject({
      code: 'onramp_webhooks_unconfigured',
      status: 503,
    });
  });

  it('does nothing in the background while switched off', async () => {
    const s = service({});
    await expect(s.retry()).resolves.toBeUndefined();
    await expect(s.reconcile()).resolves.toBeUndefined();
  });
});
