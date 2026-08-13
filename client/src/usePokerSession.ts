import { useEffect, useState } from 'react'
import {
  bindIdentity,
  enterRoom,
  getSocket,
  leaveRoomSocket,
} from './socket'
import { readSession, setSessionRoom } from './session'
import type { RoomState } from './types'

const NAME_KEY = 'trueid-poker-name'

export function usePokerSession() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const socket = getSocket()
    const onUpdate = (next: RoomState) => setRoom(next)
    const onClosed = (payload: { roomId?: string; reason?: string }) => {
      const closedId = payload.roomId ? String(payload.roomId).toUpperCase() : ''
      const savedRoomId = readSession()?.room?.roomId
      setRoom((current) => {
        if (!current) return current
        if (closedId && closedId !== current.code) return current
        return null
      })
      if (closedId && savedRoomId && closedId !== savedRoomId) return
      setSessionRoom(null)
      setPlayerId(null)
      const url = new URL(window.location.href)
      url.searchParams.delete('room')
      window.history.replaceState({}, '', url)
      setError(payload.reason || 'Host went offline. Room closed.')
    }
    socket.on('room:update', onUpdate)
    socket.on('room:closed', onClosed)
    return () => {
      socket.off('room:update', onUpdate)
      socket.off('room:closed', onClosed)
    }
  }, [])

  useEffect(() => {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim())
  }, [name])

  async function handleEnter(payload: {
    code: string
    displayName: string
    email: string
    boardName?: string
    boardId?: number
  }) {
    setBusy(true)
    setError(null)
    await bindIdentity(payload.email)
    const result = await enterRoom({
      code: payload.code,
      name: payload.displayName,
      email: payload.email,
      boardName: payload.boardName,
      boardId: payload.boardId,
    })
    setBusy(false)
    if ('error' in result) {
      setError(result.error)
      return false
    }
    setRoom(result.room)
    setPlayerId(result.playerId)
    const url = new URL(window.location.href)
    url.searchParams.set('room', result.room.code)
    window.history.replaceState({}, '', url)
    return true
  }

  function leaveRoom() {
    leaveRoomSocket()
    setRoom(null)
    setPlayerId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState({}, '', url)
  }

  return {
    name,
    setName,
    room,
    setRoom,
    playerId,
    error,
    busy,
    setError,
    handleEnter,
    leaveRoom,
  }
}
