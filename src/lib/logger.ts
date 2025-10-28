const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && LOG_LEVELS.includes(value as LogLevel);
}

function normalizeLogLevel(value: string | undefined | null): LogLevel | null {
  if (!value) {
    return null;
  }

  const lowerCased = value.toLowerCase();
  return isLogLevel(lowerCased) ? lowerCased : null;
}

const DEFAULT_LOG_LEVEL: LogLevel =
  normalizeLogLevel(process.env.LOG_LEVEL) ??
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function shouldLog(currentLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[messageLevel] <= LOG_LEVEL_PRIORITY[currentLevel];
}

type ConsoleMethod = (...args: unknown[]) => void;

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = DEFAULT_LOG_LEVEL) {
    this.level = level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public error(...args: unknown[]): void {
    this.log('error', console.error, args);
  }

  public warn(...args: unknown[]): void {
    this.log('warn', console.warn, args);
  }

  public info(...args: unknown[]): void {
    this.log('info', console.info, args);
  }

  public debug(...args: unknown[]): void {
    this.log('debug', console.debug, args);
  }

  public trace(...args: unknown[]): void {
    this.log('trace', console.trace, args);
  }

  private log(level: LogLevel, consoleMethod: ConsoleMethod, args: unknown[]): void {
    if (!shouldLog(this.level, level)) {
      return;
    }

    consoleMethod(...args);
    // TODO: Sentryなどの外部監視サービスとの統合ポイントを実装する。
  }
}

export const logger = new Logger();

