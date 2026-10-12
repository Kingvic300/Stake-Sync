/**
 * Single place errors are reported. Swap the body for Sentry or the backend log endpoint;
 * users only ever see the friendly screens, never this output.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (import.meta.env.DEV) console.error('[stake-sync]', error, context)
}
