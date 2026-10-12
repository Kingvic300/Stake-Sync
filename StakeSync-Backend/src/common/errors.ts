import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * An error that is safe to show to people. `message` is plain language with a next step;
 * `code` is stable so the apps can react to it. Anything else becomes a generic message.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what: string) => new AppError('not_found', `We couldn't find that ${what}. It may have been removed.`, HttpStatus.NOT_FOUND);
export const forbidden = (message = "You don't have access to this.") => new AppError('forbidden', message, HttpStatus.FORBIDDEN);
export const conflict = (code: string, message: string) => new AppError(code, message, HttpStatus.CONFLICT);
export const unavailable = (message = 'This is temporarily unavailable. Please try again in a few minutes.') =>
  new AppError('unavailable', message, HttpStatus.SERVICE_UNAVAILABLE);

/** For logs: an error's message, whatever was thrown. */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
