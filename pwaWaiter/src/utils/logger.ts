/**
 * Centralized logger for pwaWaiter.
 *
 * NEVER use console.log, console.warn, or console.error directly.
 * Always import and use this logger instead.
 */

const isDev = import.meta.env.DEV

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function emit(level: LogLevel, message: string, ...args: unknown[]): void {
  const prefix = `[pwaWaiter] [${level.toUpperCase()}]`
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

/**
 * handleError — extracts a human-readable message from any thrown value and
 * logs it at error level with a context label. Useful for form submit catch blocks.
 */
export function handleError(error: unknown, context: string): string {
  let message = 'Error desconocido'

  if (error instanceof Error) {
    message = error.message
  } else if (typeof error === 'string') {
    message = error
  }

  emit('error', `${context}: ${message}`, error)
  return message
}
