import { isDatabaseReady } from '../database/connection';
import { SystemLogModel } from '../modules/support/support.model';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export async function logSystemEvent(params: {
  level?: LogLevel;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
  details?: Record<string, unknown>;
  requestId?: string;
  errorName?: string;
}): Promise<void> {
  const level = params.level || 'info';
  const prefix = `[NOVARA ${params.source.toUpperCase()}]`;
  if (level === 'error') {
    console.error(prefix, params.message);
  } else if (level === 'warn') {
    console.warn(prefix, params.message);
  } else {
    console.info(prefix, params.message);
  }

  if (isDatabaseReady()) {
    try {
      await SystemLogModel.create({
        level,
        source: params.source,
        message: params.message,
        details: params.details || params.meta,
        requestId: params.requestId,
        errorName: params.errorName,
      });
    } catch {
      // Do not throw from logger
    }
  }
}
