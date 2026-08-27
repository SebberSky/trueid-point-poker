import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, chmodSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { decryptSecret, encryptSecret } from './secretStore.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data', 'rooms')

/**
 * @typedef {{ email: string, displayName: string, role: 'host' | 'member', status: 'approved' | 'pending', updatedAt: string }} RoomMember
 * @typedef {{ email: string, apiToken: string, updatedAt: string }} RoomHost
 */

/**
 * @param {string} path
 * @param {unknown} data
 */
function writeHostCredFile(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // best-effort on platforms that ignore mode
  }
}

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
 * @typedef {{ email: string, tokenCipher?: string, apiToken?: string, updatedAt: string }} RoomHostRecord
 * @typedef {{ email: string, hasApiToken: boolean }} RoomHostPublic
 */

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
 * @param {unknown} data
 * @returns {RoomHostRecord[]}
 */
function parseHostRecords(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray(data.hosts)) return data.hosts
  if (data && typeof data === 'object' && data.email) return [data]
  return []
}

/**
 * @param {RoomHostRecord[]} records
 * @returns {RoomHostRecord[]}
 */
function uniqueHostRecords(records) {
  /** @type {Map<string, RoomHostRecord>} */
  const byEmail = new Map()
  for (const rec of records) {
    const email = String(rec?.email || '')
      .trim()
      .toLowerCase()
    if (!email) continue
    byEmail.set(email, { ...rec, email })
  }
  return Array.from(byEmail.values())
}

/**
 * @param {string} roomId
 * @param {RoomHostRecord[]} records
 */
function persistHostRecords(roomId, records) {
  ensureDir()
  const hosts = []
  for (const rec of uniqueHostRecords(records)) {
    const plain = String(rec.apiToken || '').trim()
    let tokenCipher = String(rec.tokenCipher || '').trim()
    if (plain) tokenCipher = encryptSecret(plain)
    if (!tokenCipher) continue
    hosts.push({
      email: rec.email,
      tokenCipher,
      updatedAt: String(rec.updatedAt || new Date().toISOString()),
    })
  }
  writeHostCredFile(hostCredPath(roomId), { hosts })
}

/**
 * @param {string} roomId
 * @returns {RoomHostRecord[]}
 */
function loadRawHostRecords(roomId) {
  ensureDir()
  const path = hostCredPath(roomId)
  if (!existsSync(path)) return []
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const records = parseHostRecords(data)
    /** @type {RoomHostRecord[]} */
    const normalized = []
    let needsRewrite = false
    for (const rec of records) {
      const email = String(rec?.email || '')
        .trim()
        .toLowerCase()
      if (!email) continue
      const tokenCipher = String(rec?.tokenCipher || '').trim()
      const legacy = String(rec?.apiToken || '').trim()
      if (!tokenCipher && legacy) needsRewrite = true
      normalized.push({
        email,
        tokenCipher,
        apiToken: tokenCipher ? '' : legacy,
        updatedAt: String(rec?.updatedAt || ''),
      })
    }
    const unique = uniqueHostRecords(normalized)
    if (needsRewrite && unique.length) {
      try {
        persistHostRecords(roomId, unique)
      } catch (err) {
        console.error('host file migrate failed', roomId, err)
      }
    }
    return unique
  } catch (err) {
    console.error('readRoomHosts failed', roomId, err)
    return []
  }
}

/**
 * @param {string} roomId
 * @returns {RoomHost[]}
 */
export function readRoomHosts(roomId) {
  /** @type {RoomHost[]} */
  const hosts = []
  for (const rec of loadRawHostRecords(roomId)) {
    const cipher = String(rec.tokenCipher || '').trim()
    let apiToken = ''
    if (cipher) {
      try {
        apiToken = decryptSecret(cipher).trim()
      } catch (err) {
        console.error('host token decrypt failed', roomId, rec.email, err)
      }
    } else {
      apiToken = String(rec.apiToken || '').trim()
    }
    if (!apiToken) continue
    hosts.push({
      email: rec.email,
      apiToken,
      updatedAt: rec.updatedAt,
    })
  }
  return hosts
}

/**
 * Public host info for admin UI (never includes the raw token).
 * @param {string} roomId
 * @returns {{ hosts: RoomHostPublic[] }}
 */
export function getRoomHostPublic(roomId) {
  /** @type {Map<string, RoomHostPublic>} */
  const byEmail = new Map()
  for (const rec of loadRawHostRecords(roomId)) {
    const hasApiToken = Boolean(
      String(rec.tokenCipher || '').trim() || String(rec.apiToken || '').trim(),
    )
    byEmail.set(rec.email, { email: rec.email, hasApiToken })
  }
  for (const member of readRoomMembers(roomId)) {
    if (member.role !== 'host') continue
    if (!byEmail.has(member.email)) {
      byEmail.set(member.email, { email: member.email, hasApiToken: false })
    }
  }
  return { hosts: Array.from(byEmail.values()) }
}

/**
 * @param {string} roomId
 * @param {string} [email]
 * @returns {{ email: string, token: string } | null}
 */
export function getRoomHostAuth(roomId, email) {
  const hosts = readRoomHosts(roomId)
  if (!hosts.length) return null
  const wanted = String(email || '')
    .trim()
    .toLowerCase()
  const match = wanted ? hosts.find((host) => host.email === wanted) : hosts[0]
  if (!match) return null
  return { email: match.email, token: match.apiToken }
}

/**
 * Add or update one room host. Other hosts are kept.
 * @param {string} roomId
 * @param {string} hostEmail
 * @param {string} apiToken
 */
export function upsertRoomHost(roomId, hostEmail, apiToken) {
  const email = String(hostEmail || '')
    .trim()
    .toLowerCase()
  const token = String(apiToken || '').trim()
  if (!email) throw new Error('Host email is required')
  if (!token) throw new Error('Host API token is required')

  const records = loadRawHostRecords(roomId)
  const idx = records.findIndex((rec) => rec.email === email)
  const nextRecord = {
    email,
    apiToken: token,
    updatedAt: new Date().toISOString(),
  }
  if (idx >= 0) records[idx] = nextRecord
  else records.push(nextRecord)
  persistHostRecords(roomId, records)

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

  const next = Array.from(byEmail.values())
  writeRoomMembers(roomId, next)
  return {
    roomId: String(roomId).toUpperCase(),
    members: next,
    hosts: getRoomHostPublic(roomId).hosts,
  }
}

/**
 * @param {string} roomId
 * @param {string} hostEmail
 */
export function removeRoomHost(roomId, hostEmail) {
  const email = String(hostEmail || '')
    .trim()
    .toLowerCase()
  if (!email) throw new Error('Host email is required')

  persistHostRecords(
    roomId,
    loadRawHostRecords(roomId).filter((rec) => rec.email !== email),
  )

  const members = readRoomMembers(roomId).map((member) =>
    member.email === email && member.role === 'host'
      ? { ...member, role: 'member', updatedAt: new Date().toISOString() }
      : member,
  )
  writeRoomMembers(roomId, members)
  return {
    roomId: String(roomId).toUpperCase(),
    members,
    hosts: getRoomHostPublic(roomId).hosts,
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
