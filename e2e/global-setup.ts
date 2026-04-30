/**
 * Playwright global setup — runs once before all tests.
 *
 * Flushes Redis rate-limit keys so the test suite starts with a clean
 * login budget. The dev backend enforces 5 logins/minute per IP — without
 * this flush the first test that logs in after any previous session would
 * inherit a hot counter and hit 429 immediately.
 *
 * Requires: Docker is running with the integrador_redis container.
 */
import { execSync } from 'child_process'

export default async function globalSetup() {
  try {
    execSync(
      'docker exec integrador_redis redis-cli DEL ' +
        '"LIMITS:LIMITER/127.0.0.1//api/auth/login/5/1/minute" ' +
        '"rl:email:admin@demo.com" ' +
        '"rl:email:waiter@demo.com" ' +
        '"rl:email:kitchen@demo.com"',
      { stdio: 'ignore' },
    )
  } catch {
    // Non-fatal — Redis might not have these keys, or Docker might be unavailable
    // Tests will still run; they may hit the rate limit but will retry via ApiHelper
  }
}
