import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  adminListRooms,
  adminLogin,
  adminLogout,
  adminMe,
  adminRemoveHost,
  adminSetHost,
  adminVerifyHost,
  getAdminToken,
  isAllowedWorkEmail,
  type AdminRoom,
  type AdminRoomHost,
} from './jiraApi'

function hostsOf(room: AdminRoom | null | undefined): AdminRoomHost[] {
  return room?.hosts || []
}

function formatRoomHosts(hosts: AdminRoomHost[]) {
  if (!hosts.length) return ' · no host'
  return ` · ${hosts
    .map((host) => `${host.email}${host.hasApiToken ? '' : ' (no token)'}`)
    .join(', ')}`
}

function roomMatches(room: AdminRoom, query: string) {
  const q = query.trim().toUpperCase()
  if (!q) return true
  if (room.roomId.includes(q)) return true
  if (room.boardName.toUpperCase().includes(q)) return true
  if (
    String(room.projectName || '')
      .toUpperCase()
      .includes(q)
  ) {
    return true
  }
  return hostsOf(room).some((host) => host.email.toUpperCase().includes(q))
}

function verifyIdleHint(
  roomId: string,
  emailNormalized: string,
  tokenRequired: boolean,
  apiToken: string,
) {
  if (!roomId) return 'เลือกห้องก่อน แล้วกรอก email กับ token'
  if (!isAllowedWorkEmail(emailNormalized)) return 'กรอก host email ให้ครบ'
  if (tokenRequired && !apiToken.trim()) return 'กรอก API token เพื่อเริ่มตรวจสอบ'
  return 'รอตรวจสอบ…'
}

export function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [authChecking, setAuthChecking] = useState(Boolean(getAdminToken()))
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const [rooms, setRooms] = useState<AdminRoom[]>([])
  const [roomId, setRoomId] = useState('')
  const [roomQuery, setRoomQuery] = useState('')
  const [roomMenuOpen, setRoomMenuOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifyState, setVerifyState] = useState<
    'idle' | 'checking' | 'ok' | 'error'
  >('idle')
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
  const comboboxRef = useRef<HTMLDivElement>(null)
  const verifySeq = useRef(0)

  const selected = rooms.find((r) => r.roomId === roomId) || null
  const selectedHosts = hostsOf(selected)
  const emailNormalized = email.trim().toLowerCase()
  const editingHost =
    selectedHosts.find((host) => host.email === emailNormalized) || null
  const hasSavedToken = Boolean(editingHost?.hasApiToken)
  const tokenRequired = !hasSavedToken
  const canAttemptVerify =
    Boolean(roomId) &&
    isAllowedWorkEmail(emailNormalized) &&
    (!tokenRequired || Boolean(apiToken.trim()))
  const canSave = verifyState === 'ok' && Boolean(roomId) && !busy

  const filteredRooms = useMemo(
    () => rooms.filter((room) => roomMatches(room, roomQuery)),
    [rooms, roomQuery],
  )

  useEffect(() => {
    if (!getAdminToken()) {
      setAuthChecking(false)
      return
    }
    adminMe()
      .then((me) => setAuthed(Boolean(me)))
      .catch(() => setAuthed(false))
      .finally(() => setAuthChecking(false))
  }, [])

  useEffect(() => {
    if (!authed) return
    setLoading(true)
    adminListRooms()
      .then((data) => {
        setRooms(data.rooms)
        setWarning(data.warning || null)
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Load failed'
        if (msg.includes('login')) setAuthed(false)
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [authed])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!comboboxRef.current?.contains(event.target as Node)) {
        setRoomMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    if (!authed) return
    if (!canAttemptVerify) {
      setVerifyState('idle')
      setVerifyMessage(null)
      return
    }

    setVerifyState('checking')
    setVerifyMessage('กำลังตรวจสอบกับ Jira…')
    const seq = ++verifySeq.current
    const timer = window.setTimeout(() => {
      void adminVerifyHost({
        roomId,
        email: emailNormalized,
        apiToken: apiToken.trim(),
        boardId: selected?.boardId,
      })
        .then((result) => {
          if (seq !== verifySeq.current) return
          if (result.ok) {
            setVerifyState('ok')
            setVerifyMessage(
              result.displayName
                ? `ใช้งานได้ · ${result.displayName}`
                : 'ใช้งานได้ · สิทธิ์ Jira ครบ',
            )
          } else {
            setVerifyState('error')
            setVerifyMessage(result.error || 'ตรวจสอบไม่ผ่าน')
          }
        })
        .catch((err) => {
          if (seq !== verifySeq.current) return
          const msg = err instanceof Error ? err.message : 'ตรวจสอบไม่ผ่าน'
          if (msg.includes('login')) setAuthed(false)
          setVerifyState('error')
          setVerifyMessage(msg)
        })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [
    authed,
    canAttemptVerify,
    roomId,
    emailNormalized,
    apiToken,
    selected?.boardId,
  ])

  async function reload() {
    const data = await adminListRooms()
    setRooms(data.rooms)
    setWarning(data.warning || null)
    if (roomId) {
      const row = data.rooms.find((r) => r.roomId === roomId)
      if (row) setRoomQuery(row.roomId)
    }
  }

  function clearHostForm() {
    setEmail('')
    setApiToken('')
    setMessage(null)
    setError(null)
    setVerifyState('idle')
    setVerifyMessage(null)
  }

  function selectRoom(id: string) {
    setRoomId(id)
    setRoomQuery(id)
    setRoomMenuOpen(false)
    clearHostForm()
  }

  function selectHost(host: AdminRoomHost) {
    setEmail(host.email)
    setApiToken('')
    setMessage(null)
    setError(null)
    setVerifyState('idle')
    setVerifyMessage(null)
  }

  function handleRoomQueryChange(value: string) {
    const next = value.toUpperCase()
    setRoomQuery(next)
    setRoomMenuOpen(true)
    const exact = rooms.find((r) => r.roomId === next.trim())
    if (exact) {
      selectRoom(exact.roomId)
      return
    }
    if (roomId && next.trim() !== roomId) {
      setRoomId('')
      clearHostForm()
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setLoginBusy(true)
    setLoginError(null)
    try {
      await adminLogin(loginUsername, loginPassword)
      setLoginPassword('')
      setAuthed(true)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoginBusy(false)
    }
  }

  async function handleLogout() {
    await adminLogout()
    setAuthed(false)
    setRooms([])
    setRoomId('')
    setRoomQuery('')
    clearHostForm()
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    if (!roomId.trim()) {
      setError('Select a room from the list')
      return
    }
    const hostEmail = email.trim().toLowerCase()
    if (!hostEmail) {
      setError('Host email is required')
      return
    }
    if (!isAllowedWorkEmail(hostEmail)) {
      setError('Email must be @truedigital.com or @muze.co.th')
      return
    }
    if (tokenRequired && !apiToken.trim()) {
      setError('Host API token is required')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminSetHost(roomId.trim().toUpperCase(), {
        email: hostEmail,
        apiToken: apiToken.trim(),
        boardId: selected?.boardId,
      })
      setApiToken('')
      await reload()
      setMessage(`Saved ${hostEmail} for ${roomId.trim().toUpperCase()}`)
      setVerifyState('ok')
      setVerifyMessage('ใช้งานได้')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      if (msg.includes('login')) setAuthed(false)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(hostEmail: string) {
    if (!roomId.trim()) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await adminRemoveHost(roomId.trim().toUpperCase(), hostEmail)
      if (emailNormalized === hostEmail) clearHostForm()
      await reload()
      setMessage(`Removed ${hostEmail}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed'
      if (msg.includes('login')) setAuthed(false)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (authChecking) {
    return (
      <div className="landing boards-landing">
        <div className="felt-glow" aria-hidden />
        <div className="landing-inner">
          <p className="brand">Room hosts</p>
          <h1>Admin</h1>
          <p className="board-empty">Checking session…</p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="landing boards-landing">
        <div className="felt-glow" aria-hidden />
        <div className="landing-inner">
          <p className="brand">Room hosts</p>
          <h1>Admin</h1>
          <form className="entry-form" onSubmit={handleLogin}>
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {loginError ? <p className="form-error">{loginError}</p> : null}
            <button className="cta" type="submit" disabled={loginBusy}>
              {loginBusy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="landing boards-landing">
      <div className="felt-glow" aria-hidden />
      <div className="landing-inner wide">
        <div className="admin-top">
          <div>
            <p className="brand">Room hosts</p>
            <h1>Admin</h1>
          </div>
          <button type="button" className="ghost" onClick={() => void handleLogout()}>
            Log out
          </button>
        </div>

        <div className="board-panel admin-panel">
          <div className="admin-grid">
            <div>
              <h2>Rooms</h2>
              <ul className="admin-room-list">
                {loading ? <li className="board-empty">Loading rooms…</li> : null}
                {!loading && filteredRooms.length === 0 ? (
                  <li className="board-empty">No rooms found</li>
                ) : null}
                {filteredRooms.map((room) => (
                  <li key={room.roomId}>
                    <button
                      type="button"
                      className={roomId === room.roomId ? 'active' : ''}
                      onClick={() => selectRoom(room.roomId)}
                    >
                      <strong>{room.roomId}</strong>
                      <em>
                        {room.boardName}
                        {formatRoomHosts(hostsOf(room))}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <form className="entry-form" onSubmit={handleSave}>
              <label className="field">
                <span>Room</span>
                <div className="admin-room-combobox" ref={comboboxRef}>
                  <input
                    className="code-input"
                    value={roomQuery}
                    onChange={(e) => handleRoomQueryChange(e.target.value)}
                    onFocus={() => setRoomMenuOpen(true)}
                    placeholder="Search or select a room"
                    autoComplete="off"
                    required
                  />
                  {roomMenuOpen ? (
                    <ul className="admin-room-suggestions" role="listbox">
                      {filteredRooms.length === 0 ? (
                        <li className="board-empty">No match</li>
                      ) : (
                        filteredRooms.slice(0, 12).map((room) => (
                          <li key={room.roomId}>
                            <button
                              type="button"
                              className={roomId === room.roomId ? 'active' : ''}
                              onClick={() => selectRoom(room.roomId)}
                            >
                              <strong>{room.roomId}</strong>
                              <em>{room.boardName}</em>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  ) : null}
                </div>
              </label>
              {selected ? (
                <p className="admin-room-meta">
                  {selected.projectName || selected.boardName}
                  {selected.boardId ? ` · board ${selected.boardId}` : ''}
                </p>
              ) : null}
              {selected ? (
                <div className="field">
                  <span>Hosts in this room</span>
                  <ul className="admin-host-list">
                    {selectedHosts.length === 0 ? (
                      <li className="board-empty">No hosts yet</li>
                    ) : (
                      selectedHosts.map((host) => (
                        <li key={host.email}>
                          <button
                            type="button"
                            className={
                              emailNormalized === host.email ? 'active' : ''
                            }
                            onClick={() => selectHost(host)}
                          >
                            <strong>{host.email}</strong>
                            <em>
                              {host.hasApiToken ? 'token saved' : 'no token'}
                            </em>
                          </button>
                          <button
                            type="button"
                            className="ghost admin-host-remove"
                            disabled={busy}
                            onClick={() => void handleRemove(host.email)}
                          >
                            Remove
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : null}
              <label className="field">
                <span>{editingHost ? 'Update host email' : 'Add host email'}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="person@truedigital.com"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="field admin-token-field">
                <span>
                  Jira API token
                  {hasSavedToken ? ' (saved — leave blank to keep)' : ''}
                </span>
                <textarea
                  className="admin-token-input"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={
                    hasSavedToken
                      ? 'Token saved — leave blank to keep, or paste a new one'
                      : 'Atlassian API token'
                  }
                  autoComplete="off"
                  spellCheck={false}
                  required={tokenRequired}
                  rows={6}
                  style={{ resize: 'none' }}
                />
              </label>
              {warning ? <p className="form-error">{warning}</p> : null}
              {error ? <p className="form-error">{error}</p> : null}
              {message ? <p className="form-ok">{message}</p> : null}
              {verifyState === 'ok' ? (
                <button
                  className="cta admin-save admin-verify-save"
                  type="submit"
                  disabled={!canSave}
                >
                  <span className="admin-verify-icon" aria-hidden>
                    ✓
                  </span>
                  <span className="admin-verify-text">
                    {busy ? 'กำลังบันทึก…' : 'ใช้งานได้ · Save host'}
                  </span>
                </button>
              ) : (
                <div
                  className={`admin-verify-status admin-verify-status-${verifyState}`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="admin-verify-icon" aria-hidden>
                    {verifyState === 'checking' ? (
                      <span className="admin-verify-spinner" />
                    ) : verifyState === 'error' ? (
                      '✕'
                    ) : (
                      '•'
                    )}
                  </span>
                  <span className="admin-verify-text">
                    {verifyState === 'checking'
                      ? 'กำลังตรวจสอบกับ Jira…'
                      : verifyState === 'error'
                        ? verifyMessage || 'ตรวจสอบไม่ผ่าน'
                        : verifyIdleHint(
                            roomId,
                            emailNormalized,
                            tokenRequired,
                            apiToken,
                          )}
                  </span>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
