import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  fetchBoardsForEmail,
  isAllowedWorkEmail,
  requestRoomAccess,
  type BoardsResponse,
  type JiraBoard,
} from './jiraApi'

type LandingProps = {
  busy: boolean
  error: string | null
  pendingRoom: { roomId: string; boardName: string } | null
  nickname: string
  restoreEmail?: string
  onNicknameChange: (value: string) => void
  onEnterRoom: (payload: {
    roomId: string
    boardId: number
    boardName: string
    displayName: string
    email: string
  }) => Promise<void>
  onPending: (payload: { roomId: string; boardName: string; email: string }) => void
  onClearError: () => void
  onSessionStart: (payload: { email: string; displayName: string }) => void
  onChangeEmail: () => void
}

const NICKNAME_KEY = 'trueid-poker-nickname'
const NICKNAME_MAX = 15

function nicknameStorageKey(email: string) {
  return `${NICKNAME_KEY}:${email.trim().toLowerCase()}`
}

function loadSavedNickname(email: string): string | null {
  const saved = localStorage.getItem(nicknameStorageKey(email))
  if (saved?.trim()) return saved.trim().slice(0, NICKNAME_MAX)
  return null
}

export function Landing({
  busy,
  error,
  pendingRoom,
  nickname,
  restoreEmail = '',
  onNicknameChange,
  onEnterRoom,
  onPending,
  onClearError,
  onSessionStart,
  onChangeEmail,
}: LandingProps) {
  const [email, setEmail] = useState(restoreEmail)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [result, setResult] = useState<BoardsResponse | null>(null)
  const [boardQuery, setBoardQuery] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [enteringId, setEnteringId] = useState<number | null>(null)
  const [isCustomNickname, setIsCustomNickname] = useState(false)
  const restoredLookupRef = useRef(false)

  const emailOk = useMemo(() => isAllowedWorkEmail(email), [email])

  const visibleBoards = useMemo(() => {
    if (!result) return []
    const withKey = result.boards.filter((b) => b.projectKey)
    const q = boardQuery.trim().toLowerCase()
    if (!q) return withKey.filter((b) => b.assignedCount > 0)
    return withKey.filter((b) => {
      const hay = `${b.name} ${b.projectKey || ''} ${b.projectName || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [result, boardQuery])

  function persistNickname(emailAddress: string, value: string) {
    const trimmed = value.trim().slice(0, NICKNAME_MAX)
    if (!trimmed) return
    localStorage.setItem(nicknameStorageKey(emailAddress), trimmed)
    localStorage.setItem(NICKNAME_KEY, trimmed)
  }

  function clearNickname(emailAddress: string) {
    localStorage.removeItem(nicknameStorageKey(emailAddress))
  }

  async function lookupEmail(address: string) {
    setLookupBusy(true)
    setLookupError(null)
    setBoardQuery('')
    onClearError()
    try {
      const data = await fetchBoardsForEmail(address)
      const saved = loadSavedNickname(data.user.emailAddress)
      const displayName = saved || data.user.displayName
      if (saved) {
        setIsCustomNickname(true)
      } else {
        setIsCustomNickname(false)
      }
      onNicknameChange(displayName)
      onSessionStart({
        email: data.user.emailAddress,
        displayName,
      })
      setResult(data)
      setEditingName(false)
    } catch (err) {
      setResult(null)
      setLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setLookupBusy(false)
    }
  }

  useEffect(() => {
    if (restoredLookupRef.current) return
    if (!restoreEmail || !isAllowedWorkEmail(restoreEmail) || pendingRoom) return
    restoredLookupRef.current = true
    setEmail(restoreEmail)
    void lookupEmail(restoreEmail)
  }, [restoreEmail, pendingRoom])

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault()
    if (!emailOk || lookupBusy) return
    await lookupEmail(email)
  }

  function startEditName() {
    setNameDraft(isCustomNickname ? nickname : '')
    setEditingName(true)
  }

  function saveName() {
    if (!result) return
    const next = nameDraft.trim()
    if (!next) {
      clearNickname(result.user.emailAddress)
      setIsCustomNickname(false)
      onNicknameChange(result.user.displayName)
      setEditingName(false)
      return
    }
    const clipped = next.slice(0, NICKNAME_MAX)
    persistNickname(result.user.emailAddress, clipped)
    setIsCustomNickname(true)
    onNicknameChange(clipped)
    setEditingName(false)
  }

  async function handleSelectBoard(board: JiraBoard) {
    if (!result || !board.projectKey || !nickname.trim()) return
    const roomId = board.projectKey.toUpperCase()
    const displayName = isCustomNickname
      ? nickname.trim().slice(0, NICKNAME_MAX)
      : result.user.displayName.trim()
    setEnteringId(board.id)
    onClearError()
    try {
      const access = await requestRoomAccess({
        roomId,
        email: result.user.emailAddress,
        displayName,
      })
      if (access.access === 'pending') {
        onPending({
          roomId,
          boardName: board.name,
          email: result.user.emailAddress,
        })
        return
      }
      await onEnterRoom({
        roomId,
        boardId: board.id,
        boardName: board.name,
        displayName,
        email: result.user.emailAddress,
      })
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Could not enter room')
    } finally {
      setEnteringId(null)
    }
  }

  if (pendingRoom) {
    return (
      <div className="landing">
        <div className="felt-glow" aria-hidden />
        <div className="landing-inner">
          <p className="brand">TrueID Point Poker</p>
          <h1>Waiting for host</h1>
          <p className="lede">
            You have never been assigned on <strong>{pendingRoom.roomId}</strong> tickets.
            Ask a room host to approve <strong>{nickname}</strong>.
          </p>
          <div className="entry-form">
            <p className="pending-note">
              Room {pendingRoom.roomId} · {pendingRoom.boardName}
            </p>
            <p className="field-hint">This page updates when a host approves you.</p>
          </div>
        </div>
      </div>
    )
  }

  if (result) {
    const days = result.lookbackDays || 15
    const searching = boardQuery.trim().length > 0

    return (
      <div className="landing boards-landing">
        <div className="felt-glow" aria-hidden />
        <div className="landing-inner wide">
          <p className="brand">TrueID Point Poker</p>
          <h1>Your boards</h1>

          <div className="board-panel">
            <div className="identity-row">
              {editingName ? (
                <div className="name-edit">
                  <input
                    autoFocus
                    maxLength={NICKNAME_MAX}
                    placeholder="ชื่อเล่น ไม่เกิน 15 ตัว"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value.slice(0, NICKNAME_MAX))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                  />
                  <button type="button" className="ghost" onClick={saveName}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setEditingName(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="name-display">
                  <span>
                    Playing as <strong>{nickname}</strong>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={startEditName}
                    aria-label="Change name"
                    title="Change name"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setResult(null)
                  setBoardQuery('')
                  setEmail('')
                  onChangeEmail()
                }}
              >
                Change email
              </button>
            </div>

            {error || lookupError ? (
              <p className="form-error pad">{error || lookupError}</p>
            ) : null}

            {visibleBoards.length === 0 ? (
              <p className="board-empty">
                {searching
                  ? 'No boards match that name.'
                  : `No assigned tickets in the last ${days} days. Search by board name to find one.`}
              </p>
            ) : (
              <ul className="board-list">
                {visibleBoards.map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectBoard(board)}
                      disabled={
                        !nickname.trim() ||
                        busy ||
                        enteringId === board.id ||
                        editingName
                      }
                    >
                      <span className="board-list-main">
                        <strong>{board.name}</strong>
                        <em>
                          Room {board.projectKey}
                          {board.projectName ? ` · ${board.projectName}` : ''}
                          {enteringId === board.id ? ' · entering…' : ''}
                        </em>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className="board-search compact">
              <span className="visually-hidden">Search boards</span>
              <input
                type="search"
                placeholder="Search boards…"
                value={boardQuery}
                onChange={(e) => setBoardQuery(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="landing">
      <div className="felt-glow" aria-hidden />
      <div className="landing-inner">
        <p className="brand">TrueID Point Poker</p>
        <h1>Sign in with work email</h1>

        <form className="entry-form" onSubmit={handleEmailSubmit}>
          <label className="field">
            <span>Work email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="name@truedigital.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          {email && !emailOk ? (
            <p className="form-error">Use @truedigital.com or @muze.co.th only</p>
          ) : null}
          {error || lookupError ? (
            <p className="form-error">{error || lookupError}</p>
          ) : null}

          <button className="cta" type="submit" disabled={!emailOk || lookupBusy}>
            {lookupBusy ? 'Checking boards…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
