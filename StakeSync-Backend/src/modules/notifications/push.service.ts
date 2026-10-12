import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import webpush from 'web-push';
import { PushSubscription } from './entities/notification.entities.js';

/** Browser push via VAPID (free; no third-party service). Generate keys with `npx web-push generate-vapid-keys`. */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  readonly enabled: boolean;
  readonly publicKey?: string;

  constructor(
    config: ConfigService,
    @InjectRepository(PushSubscription) private readonly subs: Repository<PushSubscription>,
  ) {
    const pub = config.get<string>('push.vapidPublic');
    const priv = config.get<string>('push.vapidPrivate');
    this.enabled = Boolean(pub && priv);
    this.publicKey = pub;
    if (this.enabled) webpush.setVapidDetails(config.get('push.subject')!, pub!, priv!);
  }

  async subscribe(userId: string, endpoint: string, keys: { p256dh: string; auth: string }) {
    await this.subs.upsert({ userId, endpoint, keys }, ['endpoint']);
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.subs.delete({ userId, endpoint });
  }

  async send(userId: string, payload: { title: string; body: string; href: string }) {
    if (!this.enabled) return false;
    const list = await this.subs.findBy({ userId });
    let sent = false;
    for (const s of list) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600 });
        sent = true;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await this.subs.delete({ id: s.id });
        else this.log.warn(`Push failed: ${code ?? (e as Error).message}`);
      }
    }
    return sent;
  }
}
