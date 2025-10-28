export type HttpErrorOptions = {
  readonly code?: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
};

/**
 * APIエラーレスポンスの表現を共通化するためのエラークラス。
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
    this.cause = options.cause;
  }

  toJSON() {
    return {
      status: this.status,
      message: this.message,
      ...(this.code ? { code: this.code } : {}),
      ...(this.details ? { details: this.details } : {}),
    };
  }

  static fromUnknown(error: unknown, fallbackStatus = 500, fallbackMessage = '予期せぬエラーが発生しました。'): HttpError {
    if (error instanceof HttpError) {
      return error;
    }

    if (error instanceof Error) {
      return new HttpError(fallbackStatus, error.message, { cause: error });
    }

    return new HttpError(fallbackStatus, fallbackMessage, { cause: error });
  }
}
