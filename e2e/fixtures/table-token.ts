/**
 * generateTableToken — TypeScript replica of the Python backend HMAC token.
 *
 * Mirrors the logic in backend/shared/security/table_token.py exactly:
 *
 *   format: "{b64_payload}.{b64_signature}"
 *
 *   payload: JSON with keys sorted alphabetically (canonical form):
 *     branch_id, diner_id, exp, iat, session_id, table_id, tenant_id
 *
 *   signature: HMAC-SHA256 over the b64_payload string (UTF-8 bytes of the
 *              base64url-encoded payload, NOT the raw JSON).
 *
 *   encoding: base64url WITHOUT padding ('=' stripped).
 *
 * Transport: X-Table-Token header.
 * TTL: defaults to 3 hours (10 800 seconds).
 */
import crypto from 'crypto'

const TABLE_TOKEN_TTL_SECONDS = 10_800 // 3 hours — must match backend default

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64url')
}

export interface TableTokenParams {
  sessionId: number
  tableId: number
  dinerId: number
  branchId: number
  tenantId: number
  /** Override the secret. Falls back to TABLE_TOKEN_SECRET env var. */
  secret?: string
  /** Override issued-at unix timestamp. Defaults to now. */
  iat?: number
}

/**
 * Generate a valid X-Table-Token for use in E2E test fixtures.
 *
 * Usage:
 *   const token = generateTableToken({
 *     sessionId: 1, tableId: 2, dinerId: 3, branchId: 4, tenantId: 5,
 *   })
 */
export function generateTableToken(params: TableTokenParams): string {
  const secret = params.secret ?? process.env.TABLE_TOKEN_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'TABLE_TOKEN_SECRET must be set and at least 32 chars. ' +
        'Set it in e2e/.env.test matching the backend value.',
    )
  }

  const iat = params.iat ?? Math.floor(Date.now() / 1000)
  const exp = iat + TABLE_TOKEN_TTL_SECONDS

  // Canonical payload — keys sorted alphabetically, matching Python sort_keys=True
  const payload = {
    branch_id: params.branchId,
    diner_id: params.dinerId,
    exp,
    iat,
    session_id: params.sessionId,
    table_id: params.tableId,
    tenant_id: params.tenantId,
  }

  // Compact JSON (no spaces) — matching Python separators=(",", ":")
  const payloadJson = JSON.stringify(payload)
  const b64Payload = b64urlEncode(Buffer.from(payloadJson, 'utf8'))

  // HMAC-SHA256 over the b64_payload string (as ASCII bytes)
  const signature = crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(Buffer.from(b64Payload, 'ascii'))
    .digest()

  const b64Signature = b64urlEncode(signature)

  return `${b64Payload}.${b64Signature}`
}
