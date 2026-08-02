import { useCallback, useEffect, useRef, useState } from 'react'
import { Landing } from './Landing'
import { Room } from './Room'
import { AdminPage } from './AdminPage'
import { usePokerSession } from './usePokerSession'
import { ADMIN_PATH } from './jiraApi'
import { appPathname } from './appUrl'
import { bindIdentity, getSocket } from './socket'
import {
  clearSession,
  getValidSession,
  readSession,
  setSessionRoom,
  touchSession,
  writeSession,
} from './session'
import './App.css'

function App() {
  const path = appPathname()
  if (path === ADMIN_PATH) {
    return <AdminPage />
  }

  return <PokerApp />
}

function PokerApp() {
  const {
    setName,
    room,
    setRoom,
    playerId,
    error,
    busy,
    setError,
    handleEnter,
    leaveRoom,
  } = usePokerSession()

  const initial = getValidSession()
  const [nickname, setNickname] = useState(initial?.displayName ?? '')
  const [sessionEmail, setSessionEmail] = useState(initial?.email ?? '')
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const [pendingRoom, setPendingRoom] = useState<{
    roomId: string
    boardName: string
  } | null>(null)
  const [rejoining, setRejoining] = useState(() => Boolean(initial?.room))
  const restoredRoomRef = useRef(false)

  const expireSession = useCallback(
    (message = 'Session expired. Sign in with your work email again.') => {
      leaveRoom()
      clearSession()
      setSessionEmail('')
      setNickname('')
      setName('')
      setPendingRoom(null)
      setError(message)
      setSessionEpoch((n) => n + 1)
    },
    [leaveRoom, setError, setName],
  )

  const refreshSession = useCallback(() => {
    if (!readSession()) return true
    const next = touchSession()
    if (!next) {
      expireSession()
      return false
    }
    return true
  }, [expireSession])

  useEffect(() => {
    const onActivity = () => {
      refreshSession()
    }
    const events: Array<keyof DocumentEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'click',
    ]
    for (const event of events) {
      document.addEventListener(event, onActivity, { passive: true })
    }
    const timer = window.setInterval(() => {
      const session = getValidSession()
      if (!session && (sessionEmail || room)) {
        expireSession()
      }
    }, 15_000)
    return () => {
      for (const event of events) {
        document.removeEventListener(event, onActivity)
      }
      window.clearInterval(timer)
    }
  }, [expireSession, refreshSession, room, sessionEmail])

  useEffect(() => {
    if (restoredRoomRef.current) return
    const session = getValidSession()
    if (!session?.room) {
      setRejoining(false)
      return
    }
    restoredRoomRef.current = true
    setSessionEmail(session.email)
    setNickname(session.displayName)
    setName(session.displayName)
    void handleEnter({
      code: session.room.roomId,
      displayName: session.displayName,
      email: session.email,
      boardName: session.room.boardName,
      boardId: session.room.boardId,
    })
      .then((ok) => {
        if (!ok) setSessionRoom(null)
      })
      .finally(() => {
        setRejoining(false)
      })
  }, [handleEnter, setName])

  useEffect(() => {
    if (!pendingRoom || !sessionEmail) return
    if (!refreshSession()) return
    const socket = getSocket()
    bindIdentity(sessionEmail)
    const onApproved = async (payload: { roomId?: string }) => {
      if (payload.roomId && payload.roomId !== pendingRoom.roomId) return
      if (!refreshSession()) return
      const ok = await handleEnter({
        code: pendingRoom.roomId,
        displayName: nickname,
        email: sessionEmail,
        boardName: pendingRoom.boardName,
      })
      if (ok) {
        setSessionRoom({
          roomId: pendingRoom.roomId,
          boardName: pendingRoom.boardName,
        })
        setPendingRoom(null)
      }
    }
    const onDenied = (payload: { roomId?: string }) => {
      if (payload.roomId && payload.roomId !== pendingRoom.roomId) return
      setPendingRoom(null)
      setError('Host denied access to this room')
    }
    socket.on('access:approved', onApproved)
    socket.on('access:denied', onDenied)
    return () => {
      socket.off('access:approved', onApproved)
      socket.off('access:denied', onDenied)
    }
  }, [
    pendingRoom,
    sessionEmail,
    nickname,
    handleEnter,
    setError,
    refreshSession,
  ])

  if (room && playerId) {
    return (
      <Room
        room={room}
        playerId={playerId}
        hostEmail={sessionEmail}
        onRoomUpdate={setRoom}
        onLeave={() => {
          leaveRoom()
          setSessionRoom(null)
          setPendingRoom(null)
          touchSession()
        }}
      />
    )
  }

  if (rejoining) {
    return (
      <div className="landing">
        <div className="felt-glow" aria-hidden />
        <div className="landing-inner">
          <p className="brand">TrueID Point Poker</p>
          <h1>Rejoining room…</h1>
        </div>
      </div>
    )
  }

  return (
    <Landing
      key={sessionEpoch}
      busy={busy}
      error={error}
      pendingRoom={pendingRoom}
      nickname={nickname}
      restoreEmail={sessionEmail}
      onNicknameChange={(value) => {
        setNickname(value)
        setName(value)
        const session = getValidSession()
        if (session) {
          writeSession({
            email: session.email,
            displayName: value,
            room: session.room,
          })
        }
      }}
      onClearError={() => setError(null)}
      onSessionStart={({ email, displayName }) => {
        const current = readSession()
        writeSession({
          email,
          displayName,
          room: current?.room ?? null,
          lastActiveAt: Date.now(),
        })
        setSessionEmail(email)
        setNickname(displayName)
        setName(displayName)
      }}
      onChangeEmail={() => {
        clearSession()
        setSessionEmail('')
        setNickname('')
        setName('')
        setPendingRoom(null)
        setError(null)
        setSessionEpoch((n) => n + 1)
      }}
      onPending={({ roomId, boardName, email }) => {
        if (!refreshSession()) return
        setSessionEmail(email)
        writeSession({
          email,
          displayName: nickname,
          room: null,
        })
        setPendingRoom({ roomId, boardName })
      }}
      onEnterRoom={async ({ roomId, boardId, boardName, displayName, email }) => {
        writeSession({
          email,
          displayName,
          room: null,
          lastActiveAt: Date.now(),
        })
        setSessionEmail(email)
        setNickname(displayName)
        setName(displayName)
        const ok = await handleEnter({
          code: roomId,
          displayName,
          email,
          boardName,
          boardId,
        })
        if (!ok) return
        writeSession({
          email,
          displayName,
          room: { roomId, boardId, boardName },
          lastActiveAt: Date.now(),
        })
        setPendingRoom(null)
      }}
    />
  )
}

export default App
