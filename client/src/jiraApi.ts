import { appUrl } from './appUrl'

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(appUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  })
}

export type JiraBoard = {
  id: number
  name: string
  type: string
  projectKey: string | null
  projectName: string | null
  assignedCount: number
}

export type JiraUser = {
  accountId: string
  displayName: string
  emailAddress: string
}

export type BoardsResponse = {
  user: JiraUser
  boards: JiraBoard[]
  lookbackDays: number
  totals: {
    assignedBoards: number
    boardCount: number
    assignmentHits: number
  }
}

export type AccessResponse = {
  access: 'approved' | 'pending'
  member: {
    email: string
    displayName: string
    role: 'host' | 'member'
    status: 'approved' | 'pending'
  }
  pending: Array<{
    email: string
    displayName: string
    role: string
    status: string
    updatedAt: string
  }>
}

export type AdminRoom = {
  roomId: string
  boardId: number | null
  boardName: string
  projectName: string | null
  hostEmail: string | null
  hasApiToken: boolean
  members: Array<{
    email: string
    displayName: string
    role: string
    status: string
  }>
}

const ALLOWED_EMAIL =
  /^[a-z0-9._%+-]+@(?:truedigital\.com|muze\.co\.th)$/i

export function isAllowedWorkEmail(email: string) {
  return ALLOWED_EMAIL.test(email.trim())
}

export function atlassianLoginUrl() {
  return appUrl('/api/auth/atlassian')
}

export async function fetchAuthProviders(): Promise<{
  atlassian: boolean
  apiTokenLogin: boolean
}> {
  const res = await apiFetch('/api/auth/providers')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { atlassian: false, apiTokenLogin: false }
  }
  return {
    atlassian: Boolean(data?.atlassian),
    apiTokenLogin: Boolean(data?.apiTokenLogin),
  }
}

export async function fetchAuthMe(): Promise<{ user: JiraUser } | null> {
  const res = await apiFetch('/api/auth/me')
  if (res.status === 401) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Session check failed')
  return data as { user: JiraUser }
}

export async function logoutSession(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' })
  } catch {
    // ignore network errors on logout
  }
}

export async function fetchBoardsForSession(): Promise<BoardsResponse> {
  const res = await apiFetch('/api/boards', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('Sign in required')
  if (!res.ok) throw new Error(data?.error || 'Failed to load boards')
  return data as BoardsResponse
}

export async function requestRoomAccess(payload: {
  roomId: string
  displayName: string
}): Promise<AccessResponse> {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(payload.roomId)}/access`, {
    method: 'POST',
    body: JSON.stringify({
      displayName: payload.displayName.trim(),
    }),
  })
  const data = await res.json()
  if (res.status === 401) throw new Error('Sign in required')
  if (!res.ok) throw new Error(data?.error || 'Failed to request access')
  return data as AccessResponse
}

export async function approveRoomMember(payload: { roomId: string; email: string }) {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(payload.roomId)}/approve`, {
    method: 'POST',
    body: JSON.stringify({ email: payload.email }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Approve failed')
  return data
}

export async function denyRoomMember(payload: { roomId: string; email: string }) {
  const res = await apiFetch(`/api/rooms/${encodeURIComponent(payload.roomId)}/deny`, {
    method: 'POST',
    body: JSON.stringify({ email: payload.email }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Deny failed')
  return data
}

export async function fetchPlanningTickets(
  boardId: number,
  roomId?: string,
): Promise<import('./types').PlanningData> {
  const qs = roomId
    ? `?roomId=${encodeURIComponent(roomId.trim().toUpperCase())}`
    : ''
  const res = await apiFetch(`/api/boards/${boardId}/planning${qs}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Failed to load tickets')
  return data
}

export async function searchIssuesBySummary(payload: {
  summary: string
  excludeKey?: string
  roomId: string
}): Promise<{ summary: string; issues: import('./types').PlanningIssue[] }> {
  const res = await apiFetch('/api/issues/same-summary', {
    method: 'POST',
    body: JSON.stringify({
      summary: payload.summary,
      excludeKey: payload.excludeKey,
      roomId: payload.roomId,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Failed to find matching tickets')
  return data
}

export async function searchIssues(
  query: string,
  roomId?: string,
): Promise<{ query: string; issues: import('./types').PlanningIssue[] }> {
  const params = new URLSearchParams({ q: query.trim() })
  if (roomId) params.set('roomId', roomId.trim().toUpperCase())
  const res = await apiFetch(`/api/issues/search?${params}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Search failed')
  return data
}

export async function setIssueStoryPoints(payload: {
  key: string
  points: number
  roomId: string
  boardId?: number | null
}) {
  const res = await apiFetch(
    `/api/issues/${encodeURIComponent(payload.key)}/story-points`,
    {
      method: 'PUT',
      body: JSON.stringify({
        points: payload.points,
        roomId: payload.roomId,
        boardId: payload.boardId ?? undefined,
      }),
    },
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Failed to set story points')
  return data as {
    key: string
    points: number
    fieldId?: string | null
    boardId?: number | null
  }
}

export async function setIssueNeedQa(payload: {
  key: string
  needQa: 'Yes' | 'No'
  roomId: string
}) {
  const res = await apiFetch(
    `/api/issues/${encodeURIComponent(payload.key)}/need-qa`,
    {
      method: 'PUT',
      body: JSON.stringify({
        needQa: payload.needQa,
        roomId: payload.roomId,
      }),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Failed to set Need QA')
  return data as { key: string; needQa: string }
}

export async function setIssuePlatforms(payload: {
  key: string
  platforms: string[]
  roomId: string
}) {
  const res = await apiFetch(
    `/api/issues/${encodeURIComponent(payload.key)}/platforms`,
    {
      method: 'PUT',
      body: JSON.stringify({
        platforms: payload.platforms,
        roomId: payload.roomId,
      }),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Failed to set Platform')
  return data as { key: string; platforms: string[] }
}

export async function setIssueFixVersions(payload: {
  key: string
  fixVersions: string[]
  roomId: string
}) {
  const res = await apiFetch(
    `/api/issues/${encodeURIComponent(payload.key)}/fix-versions`,
    {
      method: 'PUT',
      body: JSON.stringify({
        fixVersions: payload.fixVersions,
        roomId: payload.roomId,
      }),
    },
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Failed to set Fix version')
  return data as { key: string; fixVersions: string[] }
}

export const ADMIN_PATH = 'room-hosts-ctrl'

const ADMIN_TOKEN_KEY = 'tipp.adminToken'

export function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || ''
}

export function setAdminToken(token: string | null) {
  if (!token) sessionStorage.removeItem(ADMIN_TOKEN_KEY)
  else sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
}

function adminHeaders(extra?: HeadersInit): HeadersInit {
  const token = getAdminToken()
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function adminLogin(username: string, password: string) {
  const res = await fetch(appUrl(`/api/${ADMIN_PATH}/login`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: username.trim(),
      password,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Login failed')
  const token = String(data?.token || '')
  if (!token) throw new Error('Login failed')
  setAdminToken(token)
  return { username: String(data.username || username) }
}

export async function adminLogout() {
  const token = getAdminToken()
  if (token) {
    try {
      await fetch(appUrl(`/api/${ADMIN_PATH}/logout`), {
        method: 'POST',
        headers: adminHeaders(),
      })
    } catch {
      // ignore network errors on logout
    }
  }
  setAdminToken(null)
}

export async function adminMe() {
  const res = await fetch(appUrl(`/api/${ADMIN_PATH}/me`), {
    headers: adminHeaders(),
  })
  if (res.status === 401) {
    setAdminToken(null)
    return null
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Session check failed')
  return data as { ok: boolean; username: string }
}

export async function adminListRooms() {
  const res = await fetch(appUrl(`/api/${ADMIN_PATH}/rooms`), {
    headers: adminHeaders(),
  })
  if (res.status === 401) {
    setAdminToken(null)
    throw new Error('Admin login required')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Failed to load rooms')
  return data as {
    rooms: AdminRoom[]
    warning?: string
  }
}

export async function adminVerifyHost(payload: {
  roomId: string
  email: string
  apiToken: string
  boardId?: number | null
}) {
  const res = await fetch(appUrl(`/api/${ADMIN_PATH}/verify-host`), {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      roomId: payload.roomId,
      email: payload.email.trim().toLowerCase(),
      apiToken: payload.apiToken,
      boardId: payload.boardId ?? undefined,
    }),
  })
  const data = await res.json()
  if (res.status === 401 && data?.error === 'Admin login required') {
    setAdminToken(null)
    throw new Error('Admin login required')
  }
  return data as {
    ok: boolean
    error?: string
    displayName?: string
    email?: string
  }
}

export async function adminSetHost(
  roomId: string,
  payload: { email: string; apiToken: string; boardId?: number | null },
) {
  const res = await fetch(appUrl(`/api/${ADMIN_PATH}/rooms/${encodeURIComponent(roomId)}/hosts`), {
    method: 'PUT',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      email: payload.email.trim().toLowerCase(),
      apiToken: payload.apiToken,
      boardId: payload.boardId ?? undefined,
    }),
  })
  if (res.status === 401) {
    setAdminToken(null)
    throw new Error('Admin login required')
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Failed to save host')
  return data as {
    roomId: string
    hostEmail: string
    hasApiToken: boolean
  }
}
