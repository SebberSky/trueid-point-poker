import { randomBytes } from 'crypto'
import { isAllowedEmail } from './jira.js'

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize'
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const ME_URL = 'https://api.atlassian.com/me'
const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'
const STATE_COOKIE = 'tipp_oauth_state'
const STATE_TTL_MS = 10 * 60 * 1000
const SCOPES = ['read:me', 'read:jira-user']

/** @type {Map<string, number>} */
const pendingStates = new Map()

export function atlassianOAuthConfigured() {
  return Boolean(
    String(process.env.ATLASSIAN_CLIENT_ID || '').trim() &&
      String(process.env.ATLASSIAN_CLIENT_SECRET || '').trim() &&
      String(process.env.ATLASSIAN_REDIRECT_URI || '').trim(),
  )
}

function clientId() {
  return String(process.env.ATLASSIAN_CLIENT_ID || '').trim()
}

function clientSecret() {
  return String(process.env.ATLASSIAN_CLIENT_SECRET || '').trim()
}

function redirectUri() {
  return String(process.env.ATLASSIAN_REDIRECT_URI || '').trim()
}

function expectedCloudUrl() {
  return String(process.env.JIRA_BASE_URL || process.env.ATLASSIAN_CLOUD_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase()
}

function appHomeUrl() {
  const fromEnv = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  if (fromEnv) return fromEnv
  const redirect = redirectUri()
  const marker = '/api/auth/atlassian/callback'
  const idx = redirect.indexOf(marker)
  if (idx > 0) return redirect.slice(0, idx)
  return '/poker'
}

/**
 * @param {boolean} [secure]
 */
function stateCookie(value, secure, maxAgeSec) {
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * @param {import('express').Request} req
 */
function requestIsSecure(req) {
  return (
    process.env.COOKIE_SECURE === 'true' ||
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
  )
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function beginAtlassianOAuth(req, res) {
  if (!atlassianOAuthConfigured()) {
    res.status(503).json({
      error:
        'Atlassian OAuth is not configured. Set ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET, and ATLASSIAN_REDIRECT_URI.',
    })
    return
  }

  const state = randomBytes(24).toString('hex')
  pendingStates.set(state, Date.now() + STATE_TTL_MS)
  const secure = requestIsSecure(req)
  res.append('Set-Cookie', stateCookie(state, secure, Math.floor(STATE_TTL_MS / 1000)))

  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId(),
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(),
    state,
    response_type: 'code',
    prompt: 'consent',
  })
  res.redirect(302, `${AUTHORIZE_URL}?${params.toString()}`)
}

/**
 * @param {import('express').Request} req
 */
function stateFromRequest(req) {
  const header = String(req.headers.cookie || '')
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    if (key !== STATE_COOKIE) continue
    try {
      return decodeURIComponent(part.slice(idx + 1).trim())
    } catch {
      return part.slice(idx + 1).trim()
    }
  }
  return ''
}

/**
 * @param {string} code
 */
async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri(),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description || data?.error || `HTTP ${res.status}`
    throw new Error(`Token exchange failed: ${detail}`)
  }
  return data
}

/**
 * @param {string} accessToken
 */
async function fetchAtlassianMe(accessToken) {
  const res = await fetch(ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.message || `Failed to load Atlassian profile (${res.status})`)
  }
  return data
}

/**
 * @param {string} accessToken
 */
async function fetchAccessibleResources(accessToken) {
  const res = await fetch(RESOURCES_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  const data = await res.json().catch(() => [])
  if (!res.ok) {
    throw new Error(`Failed to load Atlassian sites (${res.status})`)
  }
  return Array.isArray(data) ? data : []
}

/**
 * @param {unknown} me
 */
function profileFromMe(me) {
  const email = String(me?.email || '')
    .trim()
    .toLowerCase()
  const displayName =
    String(me?.name || me?.nickname || '').trim() || (email ? email.split('@')[0] : 'Player')
  const accountId = String(me?.account_id || me?.accountId || '').trim() || null
  return { email, displayName, accountId }
}

/**
 * @param {import('express').Response} res
 * @param {string} message
 */
function redirectHomeError(res, message) {
  const home = appHomeUrl()
  const sep = home.includes('?') ? '&' : '?'
  res.redirect(302, `${home}${sep}auth_error=${encodeURIComponent(message)}`)
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {(user: { email: string, displayName: string, accountId: string|null }) => void} onSuccess
 */
export async function completeAtlassianOAuth(req, res, onSuccess) {
  const secure = requestIsSecure(req)
  res.append('Set-Cookie', stateCookie('', secure, 0))

  if (!atlassianOAuthConfigured()) {
    redirectHomeError(res, 'Atlassian OAuth is not configured on the server')
    return
  }

  const error = String(req.query?.error || '').trim()
  if (error) {
    redirectHomeError(res, String(req.query?.error_description || error))
    return
  }

  const code = String(req.query?.code || '').trim()
  const state = String(req.query?.state || '').trim()
  const expected = stateFromRequest(req)
  const expiresAt = state ? pendingStates.get(state) : undefined
  if (state) pendingStates.delete(state)

  if (!code || !state || !expected || state !== expected || !expiresAt || Date.now() > expiresAt) {
    redirectHomeError(res, 'Invalid or expired OAuth state. Try signing in again.')
    return
  }

  try {
    const token = await exchangeCode(code)
    const me = await fetchAtlassianMe(token.access_token)
    const profile = profileFromMe(me)

    if (!profile.email) {
      redirectHomeError(
        res,
        'Atlassian did not return an email. Make your email visible on your Atlassian profile.',
      )
      return
    }
    if (!isAllowedEmail(profile.email)) {
      redirectHomeError(res, 'Use an @truedigital.com or @muze.co.th Atlassian account')
      return
    }

    const cloudUrl = expectedCloudUrl()
    if (cloudUrl) {
      const resources = await fetchAccessibleResources(token.access_token)
      const allowed = resources.some((site) => {
        const url = String(site?.url || '')
          .trim()
          .replace(/\/+$/, '')
          .toLowerCase()
        return url === cloudUrl
      })
      if (!allowed) {
        redirectHomeError(res, `Your Atlassian account cannot access ${cloudUrl}`)
        return
      }
    }

    onSuccess(profile)
    res.redirect(302, appHomeUrl())
  } catch (err) {
    console.error('atlassian oauth callback failed', err)
    redirectHomeError(res, err instanceof Error ? err.message : 'Atlassian login failed')
  }
}
