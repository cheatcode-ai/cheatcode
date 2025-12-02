/**
 * Frontend Logger Utility
 *
 * This utility provides conditional logging that is disabled in production
 * to improve performance. It replaces direct console.log calls throughout
 * the frontend codebase.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.debug('Debug message', data);
 *   logger.info('Info message');
 *   logger.warn('Warning message');
 *   logger.error('Error message', error);
 */

const isDevelopment = process.env.NODE_ENV === 'development';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
}

/**
 * No-op function for production
 */
const noop = () => {};

/**
 * Create a prefixed log function
 */
const createLogFn = (level: LogLevel) => {
  if (!isDevelopment) return noop;

  return (...args: unknown[]) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    switch (level) {
      case 'debug':
        console.debug(prefix, ...args);
        break;
      case 'info':
        console.info(prefix, ...args);
        break;
      case 'warn':
        console.warn(prefix, ...args);
        break;
      case 'error':
        // Always log errors, even in production
        console.error(prefix, ...args);
        break;
      default:
        console.log(prefix, ...args);
    }
  };
};

/**
 * Logger instance with conditional logging based on environment
 *
 * - In development: All logs are shown with timestamps
 * - In production: Only errors are logged
 */
export const logger: Logger = {
  debug: createLogFn('debug'),
  info: createLogFn('info'),
  warn: createLogFn('warn'),
  error: (...args: unknown[]) => {
    // Always log errors
    const timestamp = new Date().toISOString().slice(11, 23);
    console.error(`[${timestamp}] [ERROR]`, ...args);
  },
  log: isDevelopment ? console.log.bind(console) : noop,
};

/**
 * Create a namespaced logger for a specific module
 *
 * Usage:
 *   const log = createLogger('MyComponent');
 *   log.debug('Something happened');
 *   // Output: [12:34:56.789] [DEBUG] [MyComponent] Something happened
 */
export const createLogger = (namespace: string): Logger => {
  const createNamespacedLogFn = (level: LogLevel) => {
    if (!isDevelopment && level !== 'error') return noop;

    return (...args: unknown[]) => {
      const timestamp = new Date().toISOString().slice(11, 23);
      const prefix = `[${timestamp}] [${level.toUpperCase()}] [${namespace}]`;

      switch (level) {
        case 'debug':
          console.debug(prefix, ...args);
          break;
        case 'info':
          console.info(prefix, ...args);
          break;
        case 'warn':
          console.warn(prefix, ...args);
          break;
        case 'error':
          console.error(prefix, ...args);
          break;
        default:
          console.log(prefix, ...args);
      }
    };
  };

  return {
    debug: createNamespacedLogFn('debug'),
    info: createNamespacedLogFn('info'),
    warn: createNamespacedLogFn('warn'),
    error: createNamespacedLogFn('error'),
    log: isDevelopment
      ? (...args: unknown[]) => console.log(`[${namespace}]`, ...args)
      : noop,
  };
};

export default logger;
