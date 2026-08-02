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
  readRoomHostCreds,
  readRoomMembers,
  readRoomSession,
  setRoomHost,
  upsertMember,
  writeRoomMembers,
  writeRoomSession,
} from './roomStore.js'

const PORT = process.env.PORT || 3001
const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDist = join(__dirname, '../client/dist')

loadEnvFile(join(__dirname, '.env'), { override: true })

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
  fetchAttachmentBinary,
  setIssueStoryPoints,
  listAllBoards,
  defaultJiraAuth,
  verifyHostJiraAccess,
} = await import('./jira.js')

/**
 * Prefer room-host token when configured; otherwise server default (JIRA_*).
 * @param {string} [roomId]
 * @returns {{ email: string, token: string }}
 */
function resolveJiraAuth(roomId) {
  const host = roomId ? getRoomHostAuth(roomId) : null
  if (host) return host
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
app.use(cors())
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

app.post('/api/boards', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Use an @truedigital.com or @muze.co.th email' })
    return
  }

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

app.get('/api/boards/:boardId/planning', async (req, res) => {
  try {
    const roomId = roomIdFromRequest(req)
    const auth = resolveJiraAuth(roomId)
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

app.get('/api/attachments/:id/content', async (req, res) => {
  try {
    const auth = resolveJiraAuth(roomIdFromRequest(req))
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

app.get('/api/attachments/:id/thumbnail', async (req, res) => {
  try {
    const auth = resolveJiraAuth(roomIdFromRequest(req))
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

app.get('/api/issues/search', async (req, res) => {
  try {
    const auth = resolveJiraAuth(roomIdFromRequest(req))
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

app.get('/api/issues/:key', async (req, res) => {
  try {
    const roomId = roomIdFromRequest(req)
    const auth = resolveJiraAuth(roomId)
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

app.put('/api/issues/:key/story-points', async (req, res) => {
  const roomId = normalizeRoomId(req.body?.roomId)
  const hostEmail = String(req.body?.hostEmail || '')
    .trim()
    .toLowerCase()
  const host = getMember(roomId, hostEmail)
  if (!host || host.role !== 'host' || host.status !== 'approved') {
    res.status(403).json({ error: 'Hosts only' })
    return
  }

  const roomHostAuth = getRoomHostAuth(roomId)
  if (roomHostAuth && roomHostAuth.email !== hostEmail) {
    res.status(400).json({
      error: 'Room host API token is not configured for this host',
    })
    return
  }

  const auth = roomHostAuth || resolveJiraAuth(roomId)

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

app.post('/api/rooms/:roomId/access', async (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase()
  const displayName = String(req.body?.displayName || '')
    .trim()
    .slice(0, 80)

  if (!roomId) {
    res.status(400).json({ error: 'Invalid room id' })
    return
  }
  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Use an @truedigital.com or @muze.co.th email' })
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

    const user = await findJiraUserByEmail(email)
    if (!user) {
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

app.get('/api/rooms/:roomId/me', (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  const email = String(req.query.email || '')
    .trim()
    .toLowerCase()
  const member = getMember(roomId, email)
  if (!member) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json({ member, pending: member.role === 'host' ? pendingList(roomId) : [] })
})

app.post('/api/rooms/:roomId/approve', (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  const hostEmail = String(req.body?.hostEmail || '')
    .trim()
    .toLowerCase()
  const targetEmail = String(req.body?.email || '')
    .trim()
    .toLowerCase()

  const host = getMember(roomId, hostEmail)
  if (!host || host.role !== 'host' || host.status !== 'approved') {
    res.status(403).json({ error: 'Hosts only' })
    return
  }

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

app.post('/api/rooms/:roomId/deny', (req, res) => {
  const roomId = normalizeRoomId(req.params.roomId)
  const hostEmail = String(req.body?.hostEmail || '')
    .trim()
    .toLowerCase()
  const targetEmail = String(req.body?.email || '')
    .trim()
    .toLowerCase()

  const host = getMember(roomId, hostEmail)
  if (!host || host.role !== 'host' || host.status !== 'approved') {
    res.status(403).json({ error: 'Hosts only' })
    return
  }

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
        const host = getRoomHostPublic(room.roomId)
        return {
          ...room,
          hostEmail: host.hostEmail,
          hasApiToken: host.hasApiToken,
          members: readRoomMembers(room.roomId),
        }
      })
      .sort((a, b) => {
        const aReady = a.hostEmail && a.hasApiToken ? 0 : 1
        const bReady = b.hostEmail && b.hasApiToken ? 0 : 1
        if (aReady !== bReady) return aReady - bReady
        return a.roomId.localeCompare(b.roomId)
      })

    res.json({ rooms })
  } catch (err) {
    console.error('admin list rooms failed', err)
    res.json({
      warning: 'Failed to load rooms from Jira; showing local rooms only',
      rooms: listAllRooms().map((room) => {
        const host = getRoomHostPublic(room.roomId)
        return {
          roomId: room.roomId,
          boardId: null,
          boardName: room.roomId,
          projectName: null,
          hostEmail: host.hostEmail,
          hasApiToken: host.hasApiToken,
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
    const existing = readRoomHostCreds(roomId)
    if (existing?.apiToken && existing.email === email) {
      apiToken = existing.apiToken
    }
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
    const existing = readRoomHostCreds(roomId)
    if (existing?.apiToken && existing.email === email) {
      apiToken = existing.apiToken
    }
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
    const result = setRoomHost(roomId, email, apiToken)
    res.json(result)
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to save host',
    })
  }
})

app.use(express.static(clientDist))

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'] },
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
  }
}

/**
 * @param {Room} room
 * @param {import('socket.io').Socket} socket
 */
function requireHost(room, socket) {
  const player = room.players.get(socket.id)
  return Boolean(player?.isHost)
}

/**
 * @param {string} code
 */
function emitRoom(code) {
  const room = rooms.get(code)
  if (!room) return
  io.to(code).emit('room:update', publicRoomState(room))
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
    writeRoomSession(code, { revealed: false })
    rooms.delete(code)
    return
  }

  emitRoom(code)
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
  socket.on('identity:bind', ({ email }, callback) => {
    const normalized = String(email || '')
      .trim()
      .toLowerCase()
    if (!isAllowedEmail(normalized)) {
      callback?.({ error: 'Invalid email' })
      return
    }
    socket.data.email = normalized
    socketsByEmail.set(normalized, socket)
    callback?.({ ok: true })
  })

  socket.on('room:enter', ({ code, name, email, boardName, boardId }, callback) => {
    const roomId = normalizeRoomId(code)
    const trimmedName = typeof name === 'string' ? name.trim().slice(0, 80) : ''
    const normalizedEmail = String(email || '')
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
    if (!isAllowedEmail(normalizedEmail)) {
      callback?.({ error: 'Invalid email' })
      return
    }

    const member = getMember(roomId, normalizedEmail)
    if (!member || member.status !== 'approved') {
      callback?.({ error: 'Waiting for host approval', access: 'pending' })
      return
    }

    if (socket.data.roomCode && socket.data.roomCode !== roomId) {
      leaveCurrentRoom(socket, socket.data.roomCode)
    }

    let room = rooms.get(roomId)
    if (!room) {
      const saved = readRoomSession(roomId)
      room = {
        code: roomId,
        boardName: typeof boardName === 'string' ? boardName : roomId,
        boardId: Number.isFinite(parsedBoardId) ? parsedBoardId : null,
        topic: saved.topic || '',
        revealed: false,
        selectedTicket: saved.selectedTicket || null,
        players: new Map(),
      }
      if (saved.revealed) writeRoomSession(roomId, { revealed: false })
      rooms.set(roomId, room)
    } else {
      if (typeof boardName === 'string' && boardName.trim()) {
        room.boardName = boardName.trim()
      }
      if (Number.isFinite(parsedBoardId)) room.boardId = parsedBoardId
    }

    const isHost = member.role === 'host'
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

    callback?.({ room: publicRoomState(room), playerId: socket.id })
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

  socket.on('vote:cast', ({ value }) => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    const player = room?.players.get(socket.id)
    if (!room || !player || player.isHost || room.revealed) return
    const allowed = new Set(['0', '½', '1', '2', '3', '5', '8', '13', '21', '34', '?', '☕'])
    if (typeof value !== 'string' || !allowed.has(value)) return
    player.vote = value
    emitRoom(code)
  })

  socket.on('vote:clear', () => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    const player = room?.players.get(socket.id)
    if (!room || !player || player.isHost || room.revealed) return
    player.vote = null
    emitRoom(code)
  })

  socket.on('round:reveal', () => {
    const code = socket.data.roomCode
    const room = code ? rooms.get(code) : null
    if (!room || !requireHost(room, socket)) return
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
