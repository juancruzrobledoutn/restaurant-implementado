/**
 * Centralized logger for pwaMenu.
 *
 * NEVER use console.log, console.warn, or console.error directly.
 * Always import and use this logger instead.
 */

const isDev = import.meta.env.DEV

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function emit(level: LogLevel, message: string, ...args: unknown[]): void {
  const prefix = `[pwaMenu] [${level.toUpperCase()}]`
  const timestamp = new Date().toISOString()
  const formatted = `${timestamp} ${prefix} ${message}`

  switch (level) {
    case 'debug':
    case 'info':
      if (isDev) {
        // eslint-disable-next-line no-console
        console.log(formatted, ...args)
      }
      break
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(formatted, ...args)
      break
    case 'error':
      // eslint-disable-next-line no-console
      console.error(formatted, ...args)
      break
  }
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => emit('debug', message, ...args),
  info: (message: string, ...args: unknown[]) => emit('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => emit('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => emit('error', message, ...args),
}
