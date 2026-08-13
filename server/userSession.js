import { randomBytes } from 'crypto'

const COOKIE_NAME = 'tipp_session'
/** Persist login across browser restarts (no idle expiry). */
const COOKIE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 60_000
const LOGIN_MAX_ATTEMPTS = 20

/**
 * @typedef {{
 *   email: string,
 *   displayName: string,
 *   accountId: string | null,
 * }} UserSession
 */

/** @type {Map<string, UserSession>} */
const sessions = new Map()

/** @type {Map<string, number[]>} */
const loginAttempts = new Map()

/**
 * @param {import('express').Request} req
 */
export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return forwarded || req.socket?.remoteAddress || 'unknown'
}

/**
 * @param {string} ip
 */
export function allowLoginAttempt(ip) {
  const now = Date.now()
  const key = String(ip || 'unknown')
  const recent = (loginAttempts.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS)
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    loginAttempts.set(key, recent)
    return false
  }
  recent.push(now)
  loginAttempts.set(key, recent)
  return true
}

/**
 * @param {string} [cookieHeader]
 */
export function parseCookies(cookieHeader) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const part of String(cookieHeader || '').split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

/**
 * @param {import('express').Request} req
 */
export function sessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie)
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME]
  const header = String(req.headers.authorization || '')
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return ''
}

/**
 * @param {string} token
 * @returns {UserSession|null}
 */
export function getUserSession(token) {
  if (!token) return null
  return sessions.get(token) || null
}

/**
 * @param {string} token
 */
export function touchUserSession(token) {
  return getUserSession(token)
}

/**
 * @param {{ email: string, displayName: string, accountId?: string|null }} user
 */
export function createUserSession(user) {
  const token = randomBytes(32).toString('hex')
  /** @type {UserSession} */
  const session = {
    email: String(user.email || '')
      .trim()
      .toLowerCase(),
    displayName: String(user.displayName || '').trim() || 'Player',
    accountId: user.accountId || null,
  }
  sessions.set(token, session)
  return { token, session }
}

/**
 * @param {string} token
 */
export function destroyUserSession(token) {
  if (token) sessions.delete(token)
}

/**
 * @param {import('express').Request} req
 * @param {string} token
 */
export function sessionCookieOptions(req, token) {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
  return {
    name: COOKIE_NAME,
    value: token,
    maxAgeMs: COOKIE_MAX_AGE_MS,
    secure,
  }
}

/**
 * @param {import('express').Response} res
 * @param {{ name: string, value: string, maxAgeMs: number, secure: boolean }} opts
 */
export function setSessionCookie(res, opts) {
  const parts = [
    `${opts.name}=${encodeURIComponent(opts.value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`,
  ]
  if (opts.secure) parts.push('Secure')
  res.append('Set-Cookie', parts.join('; '))
}

/**
 * @param {import('express').Response} res
 * @param {boolean} [secure]
 */
export function clearSessionCookie(res, secure = false) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  res.append('Set-Cookie', parts.join('; '))
}

export { COOKIE_NAME }
