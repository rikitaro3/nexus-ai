import { logger } from './logger';

export enum ErrorType {
  VALIDATION_ERROR = 'ValidationError',
  SECURITY_ERROR = 'SecurityError',
  IPC_ERROR = 'IpcError',
  FILE_ERROR = 'FileError',
  UNKNOWN_ERROR = 'UnknownError'
}

export class AppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export function handleError(error: unknown, context?: Record<string, any>): AppError {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof Error) {
    appError = new AppError(
      ErrorType.UNKNOWN_ERROR,
      error.message,
      { ...context, originalError: error.stack }
    );
  } else {
    appError = new AppError(
      ErrorType.UNKNOWN_ERROR,
      'Unknown error occurred',
      { context, error: String(error) }
    );
  }

  logger.error(`[${appError.type}] ${appError.message}`, appError.context);
  
  return appError;
}

export function createValidationError(message: string, context?: Record<string, any>): AppError {
  return new AppError(ErrorType.VALIDATION_ERROR, message, context);
}

export function createSecurityError(message: string, context?: Record<string, any>): AppError {
  return new AppError(ErrorType.SECURITY_ERROR, message, context);
}

export function createIpcError(message: string, context?: Record<string, any>): AppError {
  return new AppError(ErrorType.IPC_ERROR, message, context);
}

export function createFileError(message: string, context?: Record<string, any>): AppError {
  return new AppError(ErrorType.FILE_ERROR, message, context);
}

