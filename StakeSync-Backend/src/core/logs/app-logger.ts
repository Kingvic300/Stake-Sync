import { ConsoleLogger } from '@nestjs/common';
import type { LogsService } from './logs.service.js';

/** Framework start-up chatter that isn't worth storing. Warnings and errors from them still are. */
const QUIET = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer', 'NestFactory', 'NestApplication', 'WebSocketsController', 'WebSocketGateway']);

/**
 * Nest's console logger, also writing to the server log. Errors go through LogsService.error so
 * they're grouped. Connected to the log service once the app has started.
 */
export class AppLogger extends ConsoleLogger {
  static sink?: LogsService;

  private split(params: unknown[]) {
    const context = typeof params.at(-1) === 'string' ? (params.at(-1) as string) : (this.context ?? 'App');
    const stack = params.length >= 2 && typeof params[0] === 'string' ? (params[0] as string) : undefined;
    return { context, stack };
  }

  override log(message: unknown, ...params: unknown[]) {
    super.log(message, ...params);
    const { context } = this.split(params);
    if (!QUIET.has(context)) AppLogger.sink?.app('info', context, String(message));
  }

  override warn(message: unknown, ...params: unknown[]) {
    super.warn(message, ...params);
    AppLogger.sink?.app('warn', this.split(params).context, String(message));
  }

  override error(message: unknown, ...params: unknown[]) {
    const { context, stack } = this.split(params);
    if (AppLogger.sink) {
      // LogsService prints it, so it isn't printed twice.
      void AppLogger.sink.error(context, message instanceof Error ? message : new Error(String(message)), {}, stack ? { stack } : {});
    } else {
      super.error(message, ...params);
    }
  }

  override fatal(message: unknown, ...params: unknown[]) {
    super.fatal(message, ...params);
    void AppLogger.sink?.error(this.split(params).context, new Error(String(message)));
  }
}
