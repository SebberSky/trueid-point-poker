const SESSION_KEY = 'trueid-poker-session'
const EMAIL_KEY = 'trueid-poker-email'

export type SessionRoom = {
  roomId: string
  boardId?: number
  boardName?: string
}

export type PokerSession = {
  email: string
  displayName: string
  lastActiveAt: number
  room: SessionRoom | null
}

function parseSession(raw: string | null): PokerSession | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<PokerSession>
    const email = String(data.email || '')
      .trim()
      .toLowerCase()
    if (!email) return null
    return {
      email,
      displayName: String(data.displayName || '').trim() || email.split('@')[0],
      lastActiveAt: Number(data.lastActiveAt) || Date.now(),
      room:
        data.room && data.room.roomId
          ? {
              roomId: String(data.room.roomId).toUpperCase(),
              boardId:
                typeof data.room.boardId === 'number' ? data.room.boardId : undefined,
              boardName: data.room.boardName
                ? String(data.room.boardName)
                : undefined,
            }
          : null,
    }
  } catch {
    return null
  }
}

export function readSession(): PokerSession | null {
  return parseSession(localStorage.getItem(SESSION_KEY))
}

export function getValidSession(): PokerSession | null {
  return readSession()
}

export function writeSession(
  patch: Partial<PokerSession> & { email: string },
): PokerSession {
  const current = readSession()
  const email = patch.email.trim().toLowerCase()
  const next: PokerSession = {
    email,
    displayName:
      (patch.displayName ?? current?.displayName ?? email.split('@')[0]).trim() ||
      email.split('@')[0],
    lastActiveAt: patch.lastActiveAt ?? Date.now(),
    room: patch.room !== undefined ? patch.room : (current?.room ?? null),
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(next))
  localStorage.setItem(EMAIL_KEY, email)
  return next
}

export function touchSession(): PokerSession | null {
  const session = readSession()
  if (!session) return null
  return writeSession({
    email: session.email,
    displayName: session.displayName,
    room: session.room,
    lastActiveAt: Date.now(),
  })
}

export function setSessionRoom(room: SessionRoom | null): PokerSession | null {
  const session = getValidSession()
  if (!session) return null
  return writeSession({
    email: session.email,
    displayName: session.displayName,
    room,
    lastActiveAt: Date.now(),
  })
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(EMAIL_KEY)
}
