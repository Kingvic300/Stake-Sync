import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errMsg } from '../../common/errors.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** "Stake-Sync <stakesync2@gmail.com>" or a bare address, as Brevo's sender object. */
export function parseSender(from: string) {
  const m = from.match(/^\s*(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '') || 'Stake-Sync', email: m[2] };
  return { name: 'Stake-Sync', email: from.trim() };
}

/**
 * Email through Brevo (free plan: 300 emails a day). The sender must be verified in Brevo: a whole
 * domain, or a single address (e.g. a Gmail) until there's a domain, in which case Brevo sends from
 * its shared @brevosend.com domain. Without a key, emails are logged in development.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private readonly key?: string;
  private readonly sender: { name: string; email: string };
  private readonly appUrl: string;

  constructor(config: ConfigService) {
    this.key = config.get('mail.brevoKey');
    this.sender = parseSender(config.get('mail.from') ?? 'Stake-Sync <stakesync2@gmail.com>');
    this.appUrl = config.get('appUrl') ?? '';
  }

  async send(to: string, subject: string, text: string, action?: { label: string; href: string }) {
    const link = action ? (action.href.startsWith('http') ? action.href : `${this.appUrl}${action.href}`) : undefined;
    const paragraphs = text
      .split('\n\n')
      .map((p) => `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
    const html = `<!doctype html><html><body style="margin:0;background:#f1f3f8;padding:24px 12px">
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.55;color:#0f172a">
<div style="padding:4px 4px 16px;font-weight:800;font-size:20px;letter-spacing:-0.01em"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#2f5bff;margin-right:8px;vertical-align:middle"></span>Stake-Sync</div>
<div style="background:#ffffff;border-radius:20px;padding:28px 24px;border:1px solid #e4e7ee">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(subject)}</h1>
${paragraphs}
${link && action ? `<p style="margin:24px 0 4px"><a href="${esc(link)}" style="display:inline-block;background:#2f5bff;color:#ffffff;padding:13px 22px;border-radius:12px;text-decoration:none;font-weight:700">${esc(action.label)}</a></p>` : ''}
</div>
<p style="color:#64748b;font-size:13px;padding:16px 4px 0;margin:0">You can choose which emails you get in Settings, Notifications. Questions? Reply to this email or write to stakesync2@gmail.com.</p>
</div></body></html>`;

    if (!this.key) {
      // Links can carry one-time tokens; the server log only gets where they point, never the token.
      this.log.log(`[dev email] to=${to} subject="${subject}"${link ? ` link=${link.split('?')[0]}` : ''}`);
      if (process.env.NODE_ENV !== 'production' && link) console.log(`[dev email link] ${link}`);
      return;
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': this.key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: this.sender,
          // Without an authenticated domain Brevo sends from @brevosend.com; replies still reach us.
          replyTo: this.sender,
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: link ? `${text}\n\n${action!.label}: ${link}` : text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // 401 with "unrecognised IP" means the server's IP needs adding under Brevo > Security > Authorised IPs.
      if (!res.ok) this.log.warn(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      // Email is best-effort; the in-app notification is the record.
      this.log.warn(`Email failed: ${errMsg(e)}`);
    }
  }
}
