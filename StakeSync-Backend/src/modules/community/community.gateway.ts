import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, type OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { CommunityService } from './community.service.js';

/**
 * Live updates: chat in challenge rooms, notifications in a personal room. Connect to `/live` with
 * `auth: { token: <access token> }`, then emit `subscribe` with a challenge id.
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(','), credentials: true } })
export class CommunityGateway implements OnGatewayConnection {
  private readonly log = new Logger('Live');
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly community: CommunityService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      const p = await this.jwt.verifyAsync<{ sub: string }>(token ?? '');
      socket.data.userId = p.sub;
      await socket.join(`user:${p.sub}`);
    } catch {
      socket.emit('error', { code: 'unauthorized', message: 'Please sign in again.' });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { challengeId: string }) {
    try {
      const { c } = await this.community.access(body.challengeId, socket.data.userId as string);
      await socket.join(`challenge:${c.id}`);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { challengeId: string }) {
    const id = await this.community.idFor(body.challengeId).catch(() => null);
    if (id) await socket.leave(`challenge:${id}`);
    return { ok: true };
  }

  @OnEvent('community.live')
  relay(e: { room: string; event: string; payload: unknown }) {
    this.server?.to(e.room).emit(e.event, e.payload);
  }

  @OnEvent('notification.created')
  notify(e: { userId: string; notification: unknown }) {
    this.server?.to(`user:${e.userId}`).emit('notification', e.notification);
  }
}
