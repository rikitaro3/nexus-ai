jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import { AppError, ErrorType, createFileError, createIpcError, createSecurityError, createValidationError, handleError } from '../error-handler';
import { logger } from '../logger';

describe('error-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the same AppError instance without wrapping again', () => {
    const original = new AppError(ErrorType.SECURITY_ERROR, 'Access denied');

    const result = handleError(original);

    expect(result).toBe(original);
    expect(logger.error).toHaveBeenCalledWith(`[${ErrorType.SECURITY_ERROR}] Access denied`, undefined);
  });

  it('wraps native errors with AppError and preserves message', () => {
    const nativeError = new Error('boom');

    const result = handleError(nativeError, { task: 'load' });

    expect(result).toBeInstanceOf(AppError);
    expect(result.type).toBe(ErrorType.UNKNOWN_ERROR);
    expect(result.message).toBe('boom');
    expect(result.context).toMatchObject({ task: 'load' });
    expect(result.context?.originalError).toContain('Error: boom');
    expect(logger.error).toHaveBeenCalledWith(`[${ErrorType.UNKNOWN_ERROR}] boom`, expect.any(Object));
  });

  it('wraps unknown values with a descriptive AppError', () => {
    const result = handleError('totally-broken');

    expect(result).toBeInstanceOf(AppError);
    expect(result.type).toBe(ErrorType.UNKNOWN_ERROR);
    expect(result.message).toBe('Unknown error occurred');
    expect(result.context).toMatchObject({ error: 'totally-broken' });
    expect(logger.error).toHaveBeenCalledWith(`[${ErrorType.UNKNOWN_ERROR}] Unknown error occurred`, expect.any(Object));
  });

  it('creates specific error types through helpers', () => {
    expect(createValidationError('invalid input').type).toBe(ErrorType.VALIDATION_ERROR);
    expect(createSecurityError('bad path').type).toBe(ErrorType.SECURITY_ERROR);
    expect(createIpcError('ipc failed').type).toBe(ErrorType.IPC_ERROR);
    expect(createFileError('file missing').type).toBe(ErrorType.FILE_ERROR);
  });
});
