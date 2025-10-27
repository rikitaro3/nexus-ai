import { AppError, ErrorType, handleError, createValidationError, createSecurityError, createIpcError, createFileError } from '../error-handler';
import { logger } from '../logger';

describe('error-handler', () => {
  const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any);

  afterEach(() => {
    errorSpy.mockClear();
  });

  afterAll(() => {
    errorSpy.mockRestore();
  });

  it('returns the same AppError instance without wrapping', () => {
    const original = new AppError(ErrorType.SECURITY_ERROR, 'unauthorized');

    const handled = handleError(original);

    expect(handled).toBe(original);
    expect(logger.error).toHaveBeenCalledWith('[SecurityError] unauthorized', undefined);
  });

  it('wraps native Error objects into AppError', () => {
    const error = new Error('boom');

    const handled = handleError(error, { action: 'load' });

    expect(handled).toBeInstanceOf(AppError);
    expect(handled.type).toBe(ErrorType.UNKNOWN_ERROR);
    expect(handled.context).toMatchObject({ action: 'load' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('creates an AppError from unknown values', () => {
    const handled = handleError('oops');

    expect(handled).toBeInstanceOf(AppError);
    expect(handled.type).toBe(ErrorType.UNKNOWN_ERROR);
    expect(handled.message).toBe('Unknown error occurred');
    expect(logger.error).toHaveBeenCalledWith('[UnknownError] Unknown error occurred', {
      context: undefined,
      error: 'oops'
    });
  });

  it('creates specialized errors via helper factories', () => {
    const validation = createValidationError('invalid', { field: 'name' });
    const security = createSecurityError('denied');
    const ipc = createIpcError('ipc failed');
    const file = createFileError('file missing');

    expect(validation).toMatchObject({ type: ErrorType.VALIDATION_ERROR, message: 'invalid' });
    expect(validation.context).toEqual({ field: 'name' });
    expect(security.type).toBe(ErrorType.SECURITY_ERROR);
    expect(ipc.type).toBe(ErrorType.IPC_ERROR);
    expect(file.type).toBe(ErrorType.FILE_ERROR);
  });
});
