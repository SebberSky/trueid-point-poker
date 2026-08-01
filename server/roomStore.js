import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data', 'rooms')

/**
 * @typedef {{ email: string, displayName: string, role: 'host' | 'member', status: 'approved' | 'pending', updatedAt: string }} RoomMember
 * @typedef {{ email: string, apiToken: string, updatedAt: string }} RoomHost
 */

function ensureDir() {
  mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * @param {string} roomId
 */
function csvPath(roomId) {
  const safe = String(roomId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  if (!safe) throw new Error('Invalid room id')
  return join(DATA_DIR, `${safe}.csv`)
}

/**
 * @param {string} value
 */
function escapeCsv(value) {
  const s = String(value ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * @param {string} line
 */
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/**
 * @param {string} roomId
 * @returns {RoomMember[]}
 */
export function readRoomMembers(roomId) {
  ensureDir()
  const path = csvPath(roomId)
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8').trim()
  if (!text) return []
  const lines = text.split(/\r?\n/)
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  const idx = {
    email: header.indexOf('email'),
    displayName: header.indexOf('displayName'),
    role: header.indexOf('role'),
    status: header.indexOf('status'),
    updatedAt: header.indexOf('updatedAt'),
  }
  if (idx.email < 0) return []

  /** @type {RoomMember[]} */
  const members = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const cols = parseCsvLine(line)
    const email = String(cols[idx.email] || '')
      .trim()
      .toLowerCase()
    if (!email) continue
    const role = cols[idx.role] === 'host' ? 'host' : 'member'
    const status = cols[idx.status] === 'pending' ? 'pending' : 'approved'
    members.push({
      email,
      displayName: String(cols[idx.displayName] || '').trim() || email.split('@')[0],
      role,
      status,
      updatedAt: String(cols[idx.updatedAt] || ''),
    })
  }
  return members
}

/**
 * @param {string} roomId
 * @param {RoomMember[]} members
 */
export function writeRoomMembers(roomId, members) {
  ensureDir()
  const lines = ['email,displayName,role,status,updatedAt']
  for (const m of members) {
    lines.push(
      [
        escapeCsv(m.email.toLowerCase()),
        escapeCsv(m.displayName),
        escapeCsv(m.role),
        escapeCsv(m.status),
        escapeCsv(m.updatedAt || new Date().toISOString()),
      ].join(','),
    )
  }
  writeFileSync(csvPath(roomId), `${lines.join('\n')}\n`, 'utf8')
}

/**
 * @param {string} roomId
 * @param {string} email
 */
export function getMember(roomId, email) {
  const normalized = email.trim().toLowerCase()
  return readRoomMembers(roomId).find((m) => m.email === normalized) || null
}

/**
 * @param {string} roomId
 * @param {Partial<RoomMember> & { email: string }} patch
 */
export function upsertMember(roomId, patch) {
  const members = readRoomMembers(roomId)
  const email = patch.email.trim().toLowerCase()
  const idx = members.findIndex((m) => m.email === email)
  /** @type {RoomMember} */
  const next = {
    email,
    displayName: patch.displayName || members[idx]?.displayName || email.split('@')[0],
    role: patch.role || members[idx]?.role || 'member',
    status: patch.status || members[idx]?.status || 'pending',
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) members[idx] = { ...members[idx], ...next, email }
  else members.push(next)
  writeRoomMembers(roomId, members)
  return next
}

/**
 * @param {string} roomId
 */
function hostCredPath(roomId) {
  const safe = String(roomId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  if (!safe) throw new Error('Invalid room id')
  return join(DATA_DIR, `${safe}.host.json`)
}

/**
 * @param {string} roomId
 * @returns {RoomHost|null}
 */
export function readRoomHostCreds(roomId) {
  ensureDir()
  const path = hostCredPath(roomId)
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const email = String(data?.email || '')
      .trim()
      .toLowerCase()
    const apiToken = String(data?.apiToken || '').trim()
    if (!email || !apiToken) return null
    return {
      email,
      apiToken,
      updatedAt: String(data?.updatedAt || ''),
    }
  } catch {
    return null
  }
}

/**
 * Public host info for admin UI (never includes the raw token).
 * @param {string} roomId
 */
export function getRoomHostPublic(roomId) {
  const creds = readRoomHostCreds(roomId)
  if (creds) {
    return { hostEmail: creds.email, hasApiToken: true }
  }
  const host = readRoomMembers(roomId).find((m) => m.role === 'host')
  return {
    hostEmail: host?.email || null,
    hasApiToken: false,
  }
}

/**
 * @param {string} roomId
 * @returns {{ email: string, token: string } | null}
 */
export function getRoomHostAuth(roomId) {
  const creds = readRoomHostCreds(roomId)
  if (!creds) return null
  return { email: creds.email, token: creds.apiToken }
}

/**
 * Set the single room host (email + API token required).
 * @param {string} roomId
 * @param {string} hostEmail
 * @param {string} apiToken
 */
export function setRoomHost(roomId, hostEmail, apiToken) {
  const email = String(hostEmail || '')
    .trim()
    .toLowerCase()
  const token = String(apiToken || '').trim()
  if (!email) throw new Error('Host email is required')
  if (!token) throw new Error('Host API token is required')

  ensureDir()
  /** @type {RoomHost} */
  const creds = {
    email,
    apiToken: token,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(hostCredPath(roomId), `${JSON.stringify(creds, null, 2)}\n`, 'utf8')

  const members = readRoomMembers(roomId)
  const byEmail = new Map(members.map((m) => [m.email, m]))
  const existing = byEmail.get(email)
  byEmail.set(email, {
    email,
    displayName: existing?.displayName || email.split('@')[0],
    role: 'host',
    status: 'approved',
    updatedAt: new Date().toISOString(),
  })

  for (const [memberEmail, member] of byEmail) {
    if (memberEmail !== email && member.role === 'host') {
      byEmail.set(memberEmail, {
        ...member,
        role: 'member',
        updatedAt: new Date().toISOString(),
      })
    }
  }

  const next = Array.from(byEmail.values())
  writeRoomMembers(roomId, next)
  return {
    roomId: String(roomId).toUpperCase(),
    members: next,
    hostEmail: email,
    hasApiToken: true,
  }
}

export function listRoomIds() {
  ensureDir()
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => f.replace(/\.csv$/i, ''))
    .sort()
}

export function listAllRooms() {
  return listRoomIds().map((id) => ({
    roomId: id,
    members: readRoomMembers(id),
  }))
}

/**
 * @typedef {{
 *   selectedTicket: { key: string, summary: string, url: string } | null,
 *   topic?: string,
 *   revealed?: boolean,
 * }} RoomSession
 */

/**
 * @param {string} roomId
 */
function sessionPath(roomId) {
  const safe = String(roomId || '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  if (!safe) throw new Error('Invalid room id')
  return join(DATA_DIR, `${safe}.session.json`)
}

/**
 * @param {string} roomId
 * @returns {RoomSession}
 */
export function readRoomSession(roomId) {
  ensureDir()
  const path = sessionPath(roomId)
  if (!existsSync(path)) {
    return { selectedTicket: null, topic: '', revealed: false }
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const ticket = data?.selectedTicket
    return {
      selectedTicket:
        ticket && ticket.key
          ? {
              key: String(ticket.key).toUpperCase(),
              summary: String(ticket.summary || ''),
              url: String(ticket.url || ''),
            }
          : null,
      topic: String(data?.topic || ''),
      revealed: Boolean(data?.revealed),
    }
  } catch {
    return { selectedTicket: null, topic: '', revealed: false }
  }
}

/**
 * @param {string} roomId
 * @param {Partial<RoomSession>} patch
 */
export function writeRoomSession(roomId, patch) {
  ensureDir()
  const current = readRoomSession(roomId)
  const next = {
    selectedTicket:
      patch.selectedTicket !== undefined
        ? patch.selectedTicket
        : current.selectedTicket,
    topic: patch.topic !== undefined ? patch.topic : current.topic,
    revealed: patch.revealed !== undefined ? patch.revealed : current.revealed,
  }
  writeFileSync(sessionPath(roomId), JSON.stringify(next, null, 2), 'utf8')
  return next
}
