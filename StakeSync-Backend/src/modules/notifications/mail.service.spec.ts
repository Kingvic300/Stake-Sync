import { ConfigService } from '@nestjs/config';
import { afterEach, vi } from 'vitest';
import { MailService, parseSender } from './mail.service.js';

describe('MailService (Brevo)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the sender from MAIL_FROM', () => {
    expect(parseSender('Stake-Sync <stakesync2@gmail.com>')).toEqual({ name: 'Stake-Sync', email: 'stakesync2@gmail.com' });
    expect(parseSender('"Stake Sync" <a@b.co>')).toEqual({ name: 'Stake Sync', email: 'a@b.co' });
    expect(parseSender('stakesync2@gmail.com')).toEqual({ name: 'Stake-Sync', email: 'stakesync2@gmail.com' });
  });

  it('sends through Brevo with the api-key header and both HTML and text', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetch);
    const mail = new MailService(new ConfigService({ mail: { brevoKey: 'xkeysib-test', from: 'Stake-Sync <stakesync2@gmail.com>' }, appUrl: 'https://app.test' }));
    await mail.send('ada@example.com', 'Reset your password', 'Use the button.', { label: 'Choose a new password', href: '/reset-password?token=t' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ name: 'Stake-Sync', email: 'stakesync2@gmail.com' });
    expect(body.to).toEqual([{ email: 'ada@example.com' }]);
    expect(body.replyTo).toEqual(body.sender);
    expect(body.htmlContent).toContain('https://app.test/reset-password?token=t');
    expect(body.textContent).toContain('Choose a new password: https://app.test/reset-password?token=t');
  });
});
