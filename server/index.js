import cors from 'cors'
import { randomBytes } from 'crypto'
import express from 'express'
import { createServer } from 'http'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'
import {
  getMember,
  getRoomHostAuth,
  getRoomHostPublic,
  listRoomIds,
  listAllRooms,
  readRoomHosts,
  readRoomMembers,
  readRoomSession,
  removeRoomHost,
  upsertRoomHost,
  upsertMember,
  writeRoomMembers,
  writeRoomSession,
  readRoomDrawings,
  writeRoomDrawings,
  clearRoomDrawings,
} from './roomStore.js'
import {
  allowLoginAttempt,
  clearSessionCookie,
  clientIp,
  createUserSession,
  destroyUserSession,
  parseCookies,
  sessionCookieOptions,
  sessionTokenFromRequest,
  setSessionCookie,
  touchUserSession,
  COOKIE_NAME,
} from './userSession.js'
import {
  atlassianOAuthConfigured,
  beginAtlassianOAuth,
  completeAtlassianOAuth,
} from './atlassianOAuth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDist = join(__dirname, '../client/dist')

loadEnvFile(join(__dirname, '.env'), { override: true })

const PORT = process.env.PORT || 3001
const ADMIN_PATH = (process.env.ADMIN_PATH || 'room-hosts-ctrl').replace(/^\/+/, '')
const ADMIN_LOGIN_USERNAME = String(
  process.env.ADMIN_LOGIN_USERNAME || process.env.ADMIN_LOGIN_EMAIL || '',
)
  .trim()
  .toLowerCase()
const ADMIN_LOGIN_PASSWORD = String(process.env.ADMIN_LOGIN_PASSWORD || '')
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000

/** @type {Map<string, number>} */
const adminSessions = new Map()

const {
  boardsForEmail,
  isAllowedEmail,
  findJiraUserByEmail,
  hasProjectAssignment,
  getBoardPlanningTickets,
  getIssueDetails,
  searchIssues,
  searchIssuesBySummary,
  fetchAttachmentBinary,
  setIssueStoryPoints,
  setIssueNeedQa,
  setIssuePlatforms,
  setIssueFixVersions,
  rankIssue,
  listAllBoards,
  defaultJiraAuth,
  verifyHostJiraAccess,
  verifyUserJiraLogin,
} = await import('./jira.js')

/**
 * Prefer the acting host's token, then any room-host token, else server default.
 * @param {string} [roomId]
 * @param {string} [preferredEmail]
 * @returns {{ email: string, token: string }}
 */
function resolveJiraAuth(roomId, preferredEmail) {
  if (roomId && preferredEmail) {
    const own = getRoomHostAuth(roomId, preferredEmail)
    if (own) return own
  }
  const host = roomId ? getRoomHostAuth(roomId) : null
  if (host) return host
  return defaultJiraAuth()
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {{ email: string, token: string } | null}
 */
function actingHostJiraAuth(req, res) {
  const roomId = req.roomId
  const hostEmail = req.user.email
  const own = getRoomHostAuth(roomId, hostEmail)
  if (own) return own
  if (getRoomHostAuth(roomId)) {
    res.status(400).json({
      error: 'Room host API token is not configured for this host',
    })
    return null
  }
  return defaultJiraAuth()
}

/**
 * @param {import('express').Request} req
 */
function roomIdFromRequest(req) {
  return String(req.query?.roomId || req.body?.roomId || '')
    .trim()
    .toUpperCase()
}

const app = express()
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
)
app.use(express.json({ limit: '64kb' }))

/**
 * @param {import('express').Request} req
 */
function adminTokenFromRequest(req) {
  const header = String(req.headers.authorization || '')
  if (header.startsWith('Bearer ')) return header.slice(7).trim()
  return ''
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAdmin(req, res, next) {
  const token = adminTokenFromRequest(req)
  const expiresAt = token ? adminSessions.get(token) : undefined
  if (!token || !expiresAt || Date.now() > expiresAt) {
    if (token) adminSessions.delete(token)
    res.status(401).json({ error: 'Admin login required' })
    return
  }
  next()
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireUser(req, res, next) {
  const token = sessionTokenFromRequest(req)
  const session = touchUserSession(token)
  if (!session) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  req.user = session
  req.userToken = token
  next()
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireApprovedRoomMember(req, res, next) {
  const roomId = normalizeRoomId(roomIdFromRequest(req) || req.params.roomId)
  if (!roomId) {
    res.status(400).json({ error: 'roomId is required' })
    return
  }
  const member = getMember(roomId, req.user.email)
  if (!member || member.status !== 'approved') {
    res.status(403).json({ error: 'Room access required' })
    return
  }
  req.roomId = roomId
  req.member = member
  next()
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireRoomHost(req, res, next) {
  const roomId = normalizeRoomId(
    req.params.roomId || roomIdFromRequest(req) || req.body?.roomId,
  )
  if (!roomId) {
    res.status(400).json({ error: 'Invalid room id' })
    return
  }
  const host = getMember(roomId, req.user.email)
  if (!host || host.role !== 'host' || host.status !== 'approved') {
    res.status(403).json({ error: 'Hosts only' })
    return
  }
  req.roomId = roomId
  req.member = host
  next()
}

app.post(`/api/${ADMIN_PATH}/login`, (req, res) => {
  if (!ADMIN_LOGIN_USERNAME || !ADMIN_LOGIN_PASSWORD) {
    res.status(503).json({ error: 'Admin login is not configured' })
    return
  }
  const username = String(req.body?.username || req.body?.email || '')
    .trim()
    .toLowerCase()
  const password = String(req.body?.password || '')
  if (username !== ADMIN_LOGIN_USERNAME || password !== ADMIN_LOGIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid username or password' })
    return
  }
  const token = randomBytes(32).toString('hex')
  adminSessions.set(token, Date.now() + ADMIN_SESSION_MS)
  res.json({ token, username })
})

app.get(`/api/${ADMIN_PATH}/me`, requireAdmin, (_req, res) => {
  res.json({ ok: true, username: ADMIN_LOGIN_USERNAME })
})

app.post(`/api/${ADMIN_PATH}/logout`, requireAdmin, (req, res) => {
  const token = adminTokenFromRequest(req)
  if (token) adminSessions.delete(token)
  res.json({ ok: true })
})

/** @type {Map<string, import('socket.io').Socket>} */
const socketsByEmail = new Map()

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/auth/atlassian', (req, res) => {
  if (!allowLoginAttempt(clientIp(req))) {
    res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' })
    return
  }
  beginAtlassianOAuth(req, res)
})

app.get('/api/auth/atlassian/callback', async (req, res) => {
  await completeAtlassianOAuth(req, res, (profile) => {
    const { token } = createUserSession({
      email: profile.email,
      displayName: profile.displayName,
      accountId: profile.accountId,
    })
    setSessionCookie(res, sessionCookieOptions(req, token))
  })
})

function bypassJiraLoginEnabled() {
  return process.env.BYPASS_JIRA_LOGIN === 'true'
}

app.get('/api/auth/providers', (_req, res) => {
  res.json({
    atlassian: atlassianOAuthConfigured(),
    apiTokenLogin: process.env.ALLOW_API_TOKEN_LOGIN === 'true',
    bypassLogin: bypassJiraLoginEnabled(),
  })
})

app.post('/api/auth/login', async (req, res) => {
  const bypassLogin = bypassJiraLoginEnabled()
  if (!bypassLogin && process.env.ALLOW_API_TOKEN_LOGIN !== 'true') {
    res.status(404).json({ error: 'Use Login with Atlassian' })
    return
  }
  if (!allowLoginAttempt(clientIp(req))) {
    res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' })
    return
  }

  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase()
  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Email must be @truedigital.com or @muze.co.th' })
    return
  }

  if (bypassLogin) {
    const displayName =
      String(req.body?.displayName || '').trim() || email.split('@')[0] || 'Player'
    const { token, session } = createUserSession({
      email,
      displayName,
      accountId: null,
    })
    setSessionCookie(res, sessionCookieOptions(req, token))
    res.json({
      user: {
        email: session.email,
        emailAddress: session.email,
        displayName: session.displayName,
        accountId: session.accountId,
      },
    })
    return
  }

  const apiToken = String(req.body?.apiToken || '').trim()

  try {
    const verified = await verifyUserJiraLogin(email, apiToken)
    if (!verified.ok) {
      res.status(verified.status || 401).json({ error: verified.error })
      return
    }

    const { token, session } = createUserSession({
      email: verified.email,
      displayName: verified.displayName,
      accountId: verified.accountId,
    })
    setSessionCookie(res, sessionCookieOptions(req, token))
    res.json({
      user: {
        email: session.email,
        emailAddress: session.email,
        displayName: session.displayName,
        accountId: session.accountId,
      },
    })
  } catch (err) {
    console.error('auth login failed', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

app.get('/api/auth/me', requireUser, (req, res) => {
  res.json({
    user: {
      email: req.user.email,
      emailAddress: req.user.email,
      displayName: req.user.displayName,
      accountId: req.user.accountId,
    },
  })
})

app.post('/api/auth/logout', (req, res) => {
  const token = sessionTokenFromRequest(req)
  destroyUserSession(token)
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https'
  clearSessionCookie(res, secure)
  res.json({ ok: true })
})

app.post('/api/boards', requireUser, async (req, res) => {
  const email = req.user.email

  try {
    const result = await boardsForEmail(email)
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('boardsForEmail failed', err)
    const status = err.status === 401 || err.status === 403 ? 502 : 500
    res.status(status).json({
      error:
        status === 502
          ? 'Jira authentication failed. Check server credentials.'
          : 'Failed to load boards from Jira',
    })
  }
})

app.get(
  '/api/boards/:boardId/planning',
  requireUser,
  requireApprovedRoomMember,
  async (req, res) => {
  try {
    const roomId = req.roomId
    const auth = resolveJiraAuth(roomId, req.user.email)
    const result = await getBoardPlanningTickets(req.params.boardId, auth)
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('planning tickets failed', err)
    res.status(500).json({ error: 'Failed to load planning tickets' })
  }
})

app.get(
  '/api/attachments/:id/content',
  requireUser,
  requireApprovedRoomMember,
  async (req, res) => {
  try {
    const auth = resolveJiraAuth(req.roomId, req.user.email)
    const result = await fetchAttachmentBinary(req.params.id, 'content', auth)
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(result.buffer)
  } catch (err) {
    console.error('attachment content failed', err)
    res.status(500).json({ error: 'Failed to load attachment' })
  }
})

app.get(
  '/api/attachments/:id/thumbnail',
  requireUser,
  requireApprovedRoomMember,
  async (req, res) => {
  try {
    const auth = resolveJiraAuth(req.roomId, req.user.email)
    const result = await fetchAttachmentBinary(req.params.id, 'thumbnail', auth)
    if (result.error) {
      const fallback = await fetchAttachmentBinary(req.params.id, 'content', auth)
      if (fallback.error) {
        res.status(fallback.status || 400).json({ error: fallback.error })
        return
      }
      res.setHeader('Content-Type', fallback.contentType)
      res.setHeader('Cache-Control', 'private, max-age=3600')
      res.send(fallback.buffer)
      return
    }
    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(result.buffer)
  } catch (err) {
    console.error('attachment thumbnail failed', err)
    res.status(500).json({ error: 'Failed to load thumbnail' })
  }
})

app.get(
  '/api/issues/search',
  requireUser,
  requireApprovedRoomMember,
  async (req, res) => {
  try {
    const auth = resolveJiraAuth(req.roomId, req.user.email)
    const result = await searchIssues(String(req.query.q || ''), auth)
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('issue search failed', err)
    res.status(500).json({ error: 'Failed to search issues' })
  }
})

app.post(
  '/api/issues/same-summary',
  requireUser,
  requireRoomHost,
  async (req, res) => {
    try {
      const auth = resolveJiraAuth(req.roomId, req.user.email)
      const result = await searchIssuesBySummary(
        String(req.body?.summary || ''),
        String(req.body?.excludeKey || req.body?.includeKey || ''),
        auth,
      )
      if (result.error) {
        res.status(result.status || 400).json({ error: result.error })
        return
      }
      res.json(result)
    } catch (err) {
      console.error('same-summary search failed', err)
      res.status(500).json({ error: 'Failed to find matching tickets' })
    }
  },
)

app.get(
  '/api/issues/:key',
  requireUser,
  requireApprovedRoomMember,
  async (req, res) => {
  try {
    const roomId = req.roomId
    const auth = resolveJiraAuth(roomId, req.user.email)
    const result = await getIssueDetails(req.params.key, auth, roomId)
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('issue details failed', err)
    const status = err.status === 404 ? 404 : 500
    res.status(status).json({
      error: status === 404 ? 'Issue not found' : 'Failed to load issue',
    })
  }
})

app.put(
  '/api/issues/:key/need-qa',
  requireUser,
  requireRoomHost,
  async (req, res) => {
  const auth = actingHostJiraAuth(req, res)
  if (!auth) return

  try {
    const result = await setIssueNeedQa(req.params.key, req.body?.needQa, auth)
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('set need qa failed', err)
    res.status(500).json({ error: 'Failed to set Need QA' })
  }
})

app.put(
  '/api/issues/:key/platforms',
  requireUser,
  requireRoomHost,
  async (req, res) => {
  const auth = actingHostJiraAuth(req, res)
  if (!auth) return

  try {
    const result = await setIssuePlatforms(
      req.params.key,
      req.body?.platforms,
      auth,
    )
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('set platforms failed', err)
    res.status(500).json({ error: 'Failed to set Platform' })
  }
})

app.put(
  '/api/issues/:key/fix-versions',
  requireUser,
  requireRoomHost,
  async (req, res) => {
  const auth = actingHostJiraAuth(req, res)
  if (!auth) return

  try {
    const result = await setIssueFixVersions(
      req.params.key,
      req.body?.fixVersions,
      auth,
    )
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('set fix versions failed', err)
    res.status(500).json({ error: 'Failed to set Fix version' })
  }
})

app.put(
  '/api/issues/:key/story-points',
  requireUser,
  requireRoomHost,
  async (req, res) => {
  const auth = actingHostJiraAuth(req, res)
  if (!auth) return

  try {
    const result = await setIssueStoryPoints(
      req.params.key,
      req.body?.points,
      req.body?.boardId,
      auth,
    )
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('set story points failed', err)
    res.status(500).json({ error: 'Failed to set story points' })
  }
})

app.put('/api/issues/:key/rank', requireUser, requireRoomHost, async (req, res) => {
  const auth = actingHostJiraAuth(req, res)
  if (!auth) return

  try {
    const result = await rankIssue(
      {
        issueKey: req.params.key,
        rankBeforeIssue: req.body?.rankBeforeIssue,
        rankAfterIssue: req.body?.rankAfterIssue,
      },
      auth,
    )
    if (result.error) {
      res.status(result.status || 400).json({ error: result.error })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('rank issue failed', err)
    res.status(500).json({ error: 'Failed to rank issue' })
  }
})

app.post('/api/rooms/:roomId/access', requireUser, async (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  const email = req.user.email
  const displayName = String(req.body?.displayName || req.user.displayName || '')
    .trim()
    .slice(0, 80)

  if (!roomId) {
    res.status(400).json({ error: 'Invalid room id' })
    return
  }
  if (!displayName) {
    res.status(400).json({ error: 'Display name is required' })
    return
  }

  try {
    const existing = getMember(roomId, email)
    if (existing?.role === 'host' || existing?.status === 'approved') {
      const member = upsertMember(roomId, {
        email,
        displayName,
        role: existing.role === 'host' ? 'host' : 'member',
        status: 'approved',
      })
      res.json({ access: 'approved', member, pending: pendingList(roomId) })
      return
    }

    if (existing?.status === 'pending') {
      const member = upsertMember(roomId, {
        email,
        displayName,
        role: 'member',
        status: 'pending',
      })
      notifyHosts(roomId, 'access:pending-updated', {
        roomId,
        pending: pendingList(roomId),
      })
      res.json({ access: 'pending', member, pending: pendingList(roomId) })
      return
    }

    const accountId = req.user.accountId
    const user = accountId
      ? { accountId, email, displayName: req.user.displayName }
      : await findJiraUserByEmail(email)
    if (!user?.accountId) {
      res.status(404).json({ error: 'No Jira user found for this email' })
      return
    }

    const assigned = await hasProjectAssignment(user.accountId, roomId)
    if (assigned) {
      const member = upsertMember(roomId, {
        email,
        displayName,
        role: 'member',
        status: 'approved',
      })
      res.json({ access: 'approved', member, pending: pendingList(roomId) })
      return
    }

    const member = upsertMember(roomId, {
      email,
      displayName,
      role: 'member',
      status: 'pending',
    })
    notifyHosts(roomId, 'access:pending-updated', {
      roomId,
      pending: pendingList(roomId),
    })
    res.json({ access: 'pending', member, pending: pendingList(roomId) })
  } catch (err) {
    console.error('room access failed', err)
    res.status(500).json({ error: 'Failed to resolve room access' })
  }
})

app.get('/api/rooms/:roomId/me', requireUser, (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  const email = req.user.email
  const member = getMember(roomId, email)
  if (!member) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json({ member, pending: member.role === 'host' ? pendingList(roomId) : [] })
})

app.post('/api/rooms/:roomId/approve', requireUser, requireRoomHost, (req, res) => {
  const roomId = req.roomId
  const targetEmail = String(req.body?.email || '')
    .trim()
    .toLowerCase()

  const target = getMember(roomId, targetEmail)
  if (!target) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  const member = upsertMember(roomId, {
    email: targetEmail,
    displayName: target.displayName,
    role: target.role === 'host' ? 'host' : 'member',
    status: 'approved',
  })
  notifyUser(targetEmail, 'access:approved', { roomId, member })
  notifyHosts(roomId, 'access:pending-updated', {
    roomId,
    pending: pendingList(roomId),
  })
  res.json({ member, pending: pendingList(roomId) })
})

app.post('/api/rooms/:roomId/deny', requireUser, requireRoomHost, (req, res) => {
  const roomId = req.roomId
  const targetEmail = String(req.body?.email || '')
    .trim()
    .toLowerCase()

  const members = readRoomMembers(roomId).filter((m) => m.email !== targetEmail)
  writeRoomMembers(roomId, members)
  notifyUser(targetEmail, 'access:denied', { roomId })
  notifyHosts(roomId, 'access:pending-updated', {
    roomId,
    pending: pendingList(roomId),
  })
  res.json({ pending: pendingList(roomId) })
})

app.get(`/api/${ADMIN_PATH}/rooms`, requireAdmin, async (_req, res) => {
  try {
    const boards = await listAllBoards()
    /** @type {Map<string, { roomId: string, boardId: number | null, boardName: string, projectName: string | null }>} */
    const byKey = new Map()
    for (const board of boards) {
      const key = String(board.projectKey || '')
        .trim()
        .toUpperCase()
      if (!key || byKey.has(key)) continue
      byKey.set(key, {
        roomId: key,
        boardId: Number(board.id) || null,
        boardName: board.name || key,
        projectName: board.projectName || null,
      })
    }
    for (const id of listRoomIds()) {
      if (byKey.has(id)) continue
      byKey.set(id, {
        roomId: id,
        boardId: null,
        boardName: id,
        projectName: null,
      })
    }

    const rooms = Array.from(byKey.values())
      .map((room) => {
        const { hosts } = getRoomHostPublic(room.roomId)
        return {
          ...room,
          hosts,
          members: readRoomMembers(room.roomId),
        }
      })
      .sort((a, b) => {
        const aReady = a.hosts.some((host) => host.hasApiToken) ? 0 : 1
        const bReady = b.hosts.some((host) => host.hasApiToken) ? 0 : 1
        if (aReady !== bReady) return aReady - bReady
        return a.roomId.localeCompare(b.roomId)
      })

    res.json({ rooms })
  } catch (err) {
    console.error('admin list rooms failed', err)
    res.json({
      warning: 'Failed to load rooms from Jira; showing local rooms only',
      rooms: listAllRooms().map((room) => {
        const { hosts } = getRoomHostPublic(room.roomId)
        return {
          roomId: room.roomId,
          boardId: null,
          boardName: room.roomId,
          projectName: null,
          hosts,
          members: room.members,
        }
      }),
    })
  }
})

app.post(`/api/${ADMIN_PATH}/verify-host`, requireAdmin, async (req, res) => {
  const roomId = normalizeRoomId(req.body?.roomId)
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase()
  let apiToken = String(req.body?.apiToken || '').trim()
  const boardId =
    req.body?.boardId === undefined || req.body?.boardId === null
      ? null
      : Number(req.body.boardId)

  if (!apiToken && roomId) {
    const existing = readRoomHosts(roomId).find((host) => host.email === email)
    if (existing?.apiToken) apiToken = existing.apiToken
  }

  try {
    const result = await verifyHostJiraAccess({
      email,
      apiToken,
      projectKey: roomId || req.body?.projectKey,
      boardId: Number.isFinite(boardId) ? boardId : null,
    })
    if (!result.ok) {
      res.status(result.status || 400).json(result)
      return
    }
    res.json(result)
  } catch (err) {
    console.error('verify host failed', err)
    res.status(500).json({ ok: false, error: 'Failed to verify Jira credentials' })
  }
})

app.put(`/api/${ADMIN_PATH}/rooms/:roomId/hosts`, requireAdmin, async (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  if (!roomId) {
    res.status(400).json({ error: 'Invalid room id' })
    return
  }

  const email = String(req.body?.email || req.body?.hostEmail || '')
    .trim()
    .toLowerCase()
  let apiToken = String(req.body?.apiToken || '').trim()
  const boardId =
    req.body?.boardId === undefined || req.body?.boardId === null
      ? null
      : Number(req.body.boardId)

  if (!email) {
    res.status(400).json({ error: 'Host email is required' })
    return
  }
  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Email must be @truedigital.com or @muze.co.th' })
    return
  }
  if (!apiToken) {
    const existing = readRoomHosts(roomId).find((host) => host.email === email)
    if (existing?.apiToken) apiToken = existing.apiToken
  }
  if (!apiToken) {
    res.status(400).json({ error: 'Host API token is required' })
    return
  }

  try {
    const verified = await verifyHostJiraAccess({
      email,
      apiToken,
      projectKey: roomId,
      boardId: Number.isFinite(boardId) ? boardId : null,
    })
    if (!verified.ok) {
      res.status(verified.status || 400).json({ error: verified.error })
      return
    }
    const result = upsertRoomHost(roomId, email, apiToken)
    res.json(result)
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to save host',
    })
  }
})

app.delete(
  `/api/${ADMIN_PATH}/rooms/:roomId/hosts/:email`,
  requireAdmin,
  (req, res) => {
    const roomId = normalizeRoomId(req.params.roomId)
    const email = decodeURIComponent(String(req.params.email || ''))
      .trim()
      .toLowerCase()
    if (!roomId) {
      res.status(400).json({ error: 'Invalid room id' })
      return
    }
    if (!email) {
      res.status(400).json({ error: 'Host email is required' })
      return
    }
    try {
      const result = removeRoomHost(roomId, email)
      res.json(result)
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to remove host',
      })
    }
  },
)

app.use(express.static(clientDist))

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'], credentials: true },
})

io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie)
  const token =
    String(socket.handshake.auth?.token || '').trim() ||
    cookies[COOKIE_NAME] ||
    ''
  const session = touchUserSession(token)
  if (!session) {
    next(new Error('Sign in required'))
    return
  }
  socket.data.userToken = token
  socket.data.email = session.email
  socket.data.displayName = session.displayName
  next()
})

/**
 * @typedef {{
 *   id: string,
 *   email: string,
 *   name: string,
 *   vote: string | null,
 *   isHost: boolean
 * }} Player
 * @typedef {{
 *   key: string,
 *   summary: string,
 *   url: string
 * }} SelectedTicket
 * @typedef {{
 *   code: string,
 *   boardName: string,
 *   boardId: number | null,
 *   topic: string,
 *   revealed: boolean,
 *   selectedTicket: SelectedTicket | null,
 *   strokes: Array<{ id: string, ticketKey: string, color: string, points: Array<{ x: number, y: number }> }>,
 *   voteDeadline: number | null,
 *   players: Map<string, Player>
 * }} Room
 */

/** @type {Map<string, Room>} */
const rooms = new Map()

/**
 * @param {Room} room
 */
function publicRoomState(room) {
  const players = Array.from(room.players.values()).map((player) => ({
    id: player.id,
    email: player.email,
    name: player.name,
    hasVoted: player.vote !== null,
    vote: room.revealed ? player.vote : null,
    isHost: player.isHost,
  }))

  const voters = players.filter((p) => !p.isHost)

  return {
    code: room.code,
    boardName: room.boardName,
    boardId: room.boardId,
    topic: room.topic,
    revealed: room.revealed,
    selectedTicket: room.selectedTicket,
    players,
    voters,
    pending: pendingList(room.code),
    strokes: Array.isArray(room.strokes) ? room.strokes : [],
    voteDeadline: Number.isFinite(room.voteDeadline) ? room.voteDeadline : null,
  }
}

/**
 * @param {Room} room
 * @param {import('socket.io').Socket} socket
 */
function playerForSocket(room, socket) {
  const byId = room.players.get(socket.id)
  if (byId) return byId
  const email = String(socket.data.email || '')
    .trim()
    .toLowerCase()
  if (!email) return null
  for (const [oldId, player] of room.players) {
    if (player.email !== email) continue
    room.players.delete(oldId)
    player.id = socket.id
    room.players.set(socket.id, player)
    return player
  }
  return null
}

function requireHost(room, socket) {
  const player = playerForSocket(room, socket)
  return Boolean(player?.isHost)
}

/**
 * @param {string} code
 */
function emitRoom(code) {
  const room = rooms.get(code)
  if (!room) return
  const state = publicRoomState(room)
  for (const player of room.players.values()) {
    io.to(player.id).emit('room:update', state)
  }
}

const DRAW_COLORS = new Set([
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#0f172a',
])
const MAX_DRAW_POINTS = 500
const MAX_DRAW_STROKES = 200

/**
 * @param {unknown} raw
 */
function sanitizeStrokeId(raw) {
  const id = String(raw || '').trim()
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : null
}

/**
 * @param {unknown} raw
 */
function sanitizeStroke(raw) {
  if (!raw || typeof raw !== 'object') return null
  const data = /** @type {{ id?: unknown, ticketKey?: unknown, color?: unknown, points?: unknown }} */ (
    raw
  )
  const id = sanitizeStrokeId(data.id)
  const ticketKey = String(data.ticketKey || '')
    .trim()
    .toUpperCase()
  if (!id || !ticketKey) return null
  const colorRaw = String(data.color || '').trim().toLowerCase()
  const color = DRAW_COLORS.has(colorRaw) ? colorRaw : '#dc2626'
  const source = Array.isArray(data.points) ? data.points : []
  /** @type {Array<{ x: number, y: number }>} */
  const points = []
  for (const item of source) {
    const row = /** @type {{ x?: unknown, y?: unknown }} */ (item || {})
    const x = Number(row.x)
    const y = Number(row.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    })
    if (points.length >= MAX_DRAW_POINTS) break
  }
  if (points.length < 2) return null
  return { id, ticketKey, color, points }
}

/**
 * @param {Room} room
 * @param {{ id: string, ticketKey: string, color: string, points: Array<{ x: number, y: number }> }} stroke
 */
function upsertRoomStroke(room, stroke) {
  if (!Array.isArray(room.strokes)) room.strokes = []
  const idx = room.strokes.findIndex((item) => item.id === stroke.id)
  if (idx >= 0) {
    room.strokes[idx] = stroke
    return
  }
  room.strokes.push(stroke)
  if (room.strokes.length > MAX_DRAW_STROKES) {
    room.strokes.splice(0, room.strokes.length - MAX_DRAW_STROKES)
  }
}

/**
 * @param {string} roomId
 */
function pendingList(roomId) {
  return readRoomMembers(roomId).filter((m) => m.status === 'pending')
}

/**
 * @param {string} roomId
 * @param {string} event
 * @param {unknown} payload
 */
function notifyHosts(roomId, event, payload) {
  const hosts = readRoomMembers(roomId).filter(
    (m) => m.role === 'host' && m.status === 'approved',
  )
  for (const host of hosts) {
    notifyUser(host.email, event, payload)
  }
  const live = rooms.get(roomId)
  if (live) {
    for (const player of live.players.values()) {
      if (player.isHost) {
        io.to(player.id).emit(event, payload)
      }
    }
  }
}

/**
 * @param {string} email
 * @param {string} event
 * @param {unknown} payload
 */
function notifyUser(email, event, payload) {
  const socket = socketsByEmail.get(email.toLowerCase())
  if (socket) socket.emit(event, payload)
}

const HOST_OFFLINE_GRACE_MS = 15_000

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const hostOfflineTimers = new Map()

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const voteDeadlineTimers = new Map()

/**
 * @param {string} code
 */
function clearVoteDeadlineTimer(code) {
  const timer = voteDeadlineTimers.get(code)
  if (timer) {
    clearTimeout(timer)
    voteDeadlineTimers.delete(code)
  }
}

/**
 * @param {Room} room
 */
function clearVoteDeadline(room) {
  clearVoteDeadlineTimer(room.code)
  room.voteDeadline = null
}

/**
 * @param {Room} room
 */
function expireVoteDeadline(room) {
  const live = rooms.get(room.code)
  if (!live || live !== room) return
  clearVoteDeadlineTimer(live.code)
  live.voteDeadline = null
  if (!live.revealed) {
    live.revealed = true
    writeRoomSession(live.code, { revealed: true })
  }
  emitRoom(live.code)
}

/**
 * @param {Room} room
 * @param {number} seconds
 */
function startVoteDeadline(room, seconds) {
  clearVoteDeadlineTimer(room.code)
  const ms = seconds === 60 ? 60_000 : 30_000
  room.voteDeadline = Date.now() + ms
  const delay = Math.max(0, room.voteDeadline - Date.now())
  const timer = setTimeout(() => {
    voteDeadlineTimers.delete(room.code)
    expireVoteDeadline(room)
  }, delay)
  voteDeadlineTimers.set(room.code, timer)
}

/**
 * @param {Room} room
 */
function votingLocked(room) {
  if (room.revealed) return true
  if (Number.isFinite(room.voteDeadline) && Date.now() >= room.voteDeadline) {
    return true
  }
  return false
}

/**
 * @param {Room} room
 */
function roomHasOnlineHost(room) {
  for (const player of room.players.values()) {
    if (player.isHost) return true
  }
  return false
}

/**
 * @param {string} roomId
 */
function clearHostOfflineTimer(roomId) {
  const timer = hostOfflineTimers.get(roomId)
  if (timer) {
    clearTimeout(timer)
    hostOfflineTimers.delete(roomId)
  }
}

/**
 * @param {string} roomId
 * @param {string} reason
 */
function closeRoom(roomId, reason) {
  clearHostOfflineTimer(roomId)
  clearVoteDeadlineTimer(roomId)
  const room = rooms.get(roomId)
  if (!room) return

  io.to(roomId).emit('room:closed', { roomId, reason })
  for (const socketId of room.players.keys()) {
    const memberSocket = io.sockets.sockets.get(socketId)
    if (memberSocket) {
      memberSocket.leave(roomId)
      memberSocket.data.roomCode = null
    }
  }
  writeRoomSession(roomId, { revealed: false })
  clearRoomDrawings(roomId)
  rooms.delete(roomId)
}

/**
 * @param {string} roomId
 */
function scheduleCloseIfHostOffline(roomId) {
  const room = rooms.get(roomId)
  if (!room) {
    clearHostOfflineTimer(roomId)
    return
  }
  if (roomHasOnlineHost(room)) {
    clearHostOfflineTimer(roomId)
    return
  }
  if (hostOfflineTimers.has(roomId)) return
  const timer = setTimeout(() => {
    hostOfflineTimers.delete(roomId)
    const live = rooms.get(roomId)
    if (!live || roomHasOnlineHost(live)) return
    closeRoom(roomId, 'Host went offline')
  }, HOST_OFFLINE_GRACE_MS)
  hostOfflineTimers.set(roomId, timer)
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {string} code
 */
function leaveCurrentRoom(socket, code) {
  const room = rooms.get(code)
  if (!room) return

  room.players.delete(socket.id)
  socket.leave(code)
  socket.data.roomCode = null

  if (room.players.size === 0) {
    clearHostOfflineTimer(code)
    writeRoomSession(code, { revealed: false })
    rooms.delete(code)
    return
  }

  emitRoom(code)
  scheduleCloseIfHostOffline(code)
}

/**
 * @param {unknown} value
 */
function normalizeRoomId(value) {
  const id = String(value || '')
    .trim()
    .toUpperCase()
  return /^[A-Z][A-Z0-9]{1,15}$/.test(id) ? id : ''
}

io.on('connection', (socket) => {
  const boundEmail = String(socket.data.email || '')
    .trim()
    .toLowerCase()
  if (boundEmail) {
    socketsByEmail.set(boundEmail, socket)
  }

  socket.on('identity:bind', (_payload, callback) => {
    const normalized = String(socket.data.email || '')
      .trim()
      .toLowerCase()
    if (!normalized) {
      callback?.({ error: 'Sign in required' })
      return
    }
    socketsByEmail.set(normalized, socket)
    callback?.({ ok: true, email: normalized })
  })

  socket.on('room:enter', ({ code, name, boardName, boardId }, callback) => {
    const roomId = normalizeRoomId(code)
    const trimmedName = typeof name === 'string' ? name.trim().slice(0, 80) : ''
    const normalizedEmail = String(socket.data.email || '')
      .trim()
      .toLowerCase()
    const parsedBoardId = Number(boardId)

    if (!roomId) {
      callback?.({ error: 'Invalid room id' })
      return
    }
    if (!trimmedName) {
      callback?.({ error: 'Name is required' })
      return
    }
    if (!normalizedEmail) {
      callback?.({ error: 'Sign in required' })
      return
    }

    const member = getMember(roomId, normalizedEmail)
    if (!member || member.status !== 'approved') {
      callback?.({ error: 'Waiting for host approval', access: 'pending' })
      return
    }

    const isHost = member.role === 'host'
    let room = rooms.get(roomId)
    if (!isHost && (!room || !roomHasOnlineHost(room))) {
      callback?.({
        error: 'Host is offline. Wait for the host to open the room.',
        hostOffline: true,
      })
      return
    }

    if (socket.data.roomCode && socket.data.roomCode !== roomId) {
      leaveCurrentRoom(socket, socket.data.roomCode)
    }

    if (!room) {
      const saved = readRoomSession(roomId)
      room = {
        code: roomId,
        boardName: typeof boardName === 'string' ? boardName : roomId,
        boardId: Number.isFinite(parsedBoardId) ? parsedBoardId : null,
        topic: saved.topic || '',
        revealed: false,
        selectedTicket: saved.selectedTicket || null,
        strokes: readRoomDrawings(roomId)
          .map((item) => sanitizeStroke(item))
          .filter(Boolean),
        voteDeadline: null,
        players: new Map(),
      }
      if (saved.revealed) writeRoomSession(roomId, { revealed: false })
      rooms.set(roomId, room)
    } else {
      if (typeof boardName === 'string' && boardName.trim()) {
        room.boardName = boardName.trim()
      }
      if (Number.isFinite(parsedBoardId)) room.boardId = parsedBoardId
      if (!Array.isArray(room.strokes)) {
        room.strokes = readRoomDrawings(roomId)
          .map((item) => sanitizeStroke(item))
          .filter(Boolean)
      }
    }

    room.players.set(socket.id, {
      id: socket.id,
      email: normalizedEmail,
      name: trimmedName,
      vote: null,
      isHost,
    })

    socket.data.email = normalizedEmail
    socket.data.roomCode = roomId
    socketsByEmail.set(normalizedEmail, socket)
    socket.join(roomId)

    upsertMember(roomId, {
      email: normalizedEmail,
      displayName: trimmedName,
      role: isHost ? 'host' : 'member',
      status: 'approved',
    })

    if (isHost) clearHostOfflineTimer(roomId)

    callback?.({
      room: publicRoomState(room),
      playerId: socket.id,
    })
    emitRoom(roomId)
  })

  socket.on('ticket:select', ({ key, summary, url }, callback) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) {
      callback?.({ error: 'Hosts only' })
      return
    }
    const ticketKey = String(key || '').trim().toUpperCase()
    if (!ticketKey) {
      callback?.({ error: 'Ticket key required' })
      return
    }

    room.selectedTicket = {
      key: ticketKey,
      summary: String(summary || '').trim().slice(0, 200),
      url: String(url || '').trim(),
    }
    room.topic = `${ticketKey}${room.selectedTicket.summary ? ` · ${room.selectedTicket.summary}` : ''}`.slice(0, 120)
    room.revealed = false
    for (const player of room.players.values()) {
      if (!player.isHost) player.vote = null
    }
    clearVoteDeadline(room)
    writeRoomSession(code, {
      selectedTicket: room.selectedTicket,
      topic: room.topic,
      revealed: room.revealed,
    })
    emitRoom(code)
    callback?.({ ok: true, room: publicRoomState(room) })
  })

  socket.on('room:topic', ({ topic }) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) return
    room.topic = typeof topic === 'string' ? topic.trim().slice(0, 120) : ''
    writeRoomSession(code, { topic: room.topic })
    emitRoom(code)
  })

  socket.on('draw:stroke', (payload) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) return
    const stroke = sanitizeStroke(payload?.stroke || payload)
    if (!stroke) return
    upsertRoomStroke(room, stroke)
    writeRoomDrawings(code, room.strokes)
    emitRoom(code)
  })

  socket.on('draw:remove', (payload) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) return
    const id = sanitizeStrokeId(payload?.id)
    if (!id || !Array.isArray(room.strokes)) return
    const next = room.strokes.filter((item) => item.id !== id)
    if (next.length === room.strokes.length) return
    room.strokes = next
    writeRoomDrawings(code, room.strokes)
    emitRoom(code)
  })

  socket.on('vote:cast', ({ value }, callback) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    const player = room ? playerForSocket(room, socket) : null
    if (!room || !player || player.isHost || votingLocked(room)) {
      callback?.({ error: 'Cannot vote now' })
      return
    }
    const allowed = new Set(['0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '?', '☕'])
    if (typeof value !== 'string' || !allowed.has(value)) {
      callback?.({ error: 'Invalid vote' })
      return
    }
    player.vote = value
    emitRoom(code)
    callback?.({ ok: true })
  })

  socket.on('vote:clear', (callback) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    const player = room ? playerForSocket(room, socket) : null
    if (!room || !player || player.isHost || votingLocked(room)) {
      callback?.({ error: 'Cannot clear vote now' })
      return
    }
    player.vote = null
    emitRoom(code)
    callback?.({ ok: true })
  })

  socket.on('vote:timer-start', ({ seconds }, callback) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) {
      callback?.({ error: 'Hosts only' })
      return
    }
    if (room.revealed) {
      callback?.({ error: 'Round already revealed' })
      return
    }
    const duration = Number(seconds)
    if (duration !== 30 && duration !== 60) {
      callback?.({ error: 'Timer must be 30 or 60 seconds' })
      return
    }
    if (Number.isFinite(room.voteDeadline) && Date.now() < room.voteDeadline) {
      callback?.({ error: 'Timer already running' })
      return
    }
    startVoteDeadline(room, duration)
    emitRoom(code)
    callback?.({ ok: true, voteDeadline: room.voteDeadline })
  })

  socket.on('round:reveal', () => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) return
    clearVoteDeadline(room)
    room.revealed = true
    writeRoomSession(code, { revealed: true })
    emitRoom(code)
  })

  socket.on('round:reset', () => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) return
    room.revealed = false
    for (const player of room.players.values()) {
      if (!player.isHost) player.vote = null
    }
    clearVoteDeadline(room)
    writeRoomSession(code, { revealed: false })
    emitRoom(code)
  })

  socket.on('room:leave', () => {
    const code = socket.data.roomCode
    if (code) leaveCurrentRoom(socket, code)
  })

  socket.on('disconnect', () => {
    const email = socket.data.email
    if (email && socketsByEmail.get(email) === socket) {
      socketsByEmail.delete(email)
    }
    const code = socket.data.roomCode
    if (code) leaveCurrentRoom(socket, code)
  })
})

app.get(/.*/, (req, res) => {
  res.sendFile(join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run npm run build in /client.')
  })
})

httpServer.listen(PORT, () => {
  console.log(`TrueID Point Poker server on http://localhost:${PORT}`)
  console.log(`Admin path: /${ADMIN_PATH}`)
})

/**
 * @param {string} filePath
 * @param {{ override?: boolean }} [options]
 */
function loadEnvFile(filePath, options = {}) {
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (options.override || !(key in process.env)) process.env[key] = value
  }
}
