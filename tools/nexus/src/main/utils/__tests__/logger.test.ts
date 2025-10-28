describe('logger', () => {
  const originalEnv = process.env.NEXUS_DEBUG;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    if (originalEnv === undefined) {
      delete process.env.NEXUS_DEBUG;
    } else {
      process.env.NEXUS_DEBUG = originalEnv;
    }
  });

  function loadLogger() {
    return require('../logger') as typeof import('../logger');
  }

  it('logs info, warn and error messages when debug mode is disabled', () => {
    delete process.env.NEXUS_DEBUG;
    jest.resetModules();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { logger } = loadLogger();

    logger.debug('hidden debug');
    expect(logSpy).not.toHaveBeenCalled();

    logger.info('visible info', { area: 'test' });
    expect(logSpy).toHaveBeenCalledWith('[INFO]', 'visible info', JSON.stringify({ area: 'test' }, null, 2));

    logger.warn('careful', { path: '/tmp' });
    expect(warnSpy).toHaveBeenCalledWith('[WARN]', 'careful', JSON.stringify({ path: '/tmp' }, null, 2));

    logger.error('serious', { code: 500 });
    expect(errorSpy).toHaveBeenCalledWith('[ERROR]', 'serious', JSON.stringify({ code: 500 }, null, 2));
  });

  it('logs debug messages when NEXUS_DEBUG=1', () => {
    process.env.NEXUS_DEBUG = '1';
    jest.resetModules();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const { logger } = loadLogger();
    logger.debug('show me');

    expect(logSpy).toHaveBeenCalledWith('[DEBUG]', 'show me', '');
  });
});
