describe('logger', () => {
  const originalEnv = process.env;
  const originalConsole = { ...console };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('logs debug messages when NEXUS_DEBUG is enabled', () => {
    process.env.NEXUS_DEBUG = '1';
    const { logger } = require('../logger');

    logger.debug('debug-message');

    expect(console.log).toHaveBeenCalledWith('[DEBUG]', 'debug-message', '');
  });

  it('suppresses debug logs when NEXUS_DEBUG is disabled', () => {
    delete process.env.NEXUS_DEBUG;
    const { logger } = require('../logger');

    logger.debug('debug-message');
    logger.info('info-message');
    logger.warn('warn-message');
    logger.error('error-message');

    expect(console.log).not.toHaveBeenCalledWith('[DEBUG]', 'debug-message', '');
    expect(console.log).toHaveBeenCalledWith('[INFO]', 'info-message', '');
    expect(console.warn).toHaveBeenCalledWith('[WARN]', 'warn-message', '');
    expect(console.error).toHaveBeenCalledWith('[ERROR]', 'error-message', '');
  });

  it('stringifies context objects before logging', () => {
    process.env.NEXUS_DEBUG = '1';
    const { logger } = require('../logger');

    const context = { feature: 'test', status: 'ok' };
    logger.info('info', context);

    expect(console.log).toHaveBeenCalledWith('[INFO]', 'info', JSON.stringify(context, null, 2));
  });
});
