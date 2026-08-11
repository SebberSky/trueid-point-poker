import { io, type Socket } from 'socket.io-client'
import type { RoomState } from './types'

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined

export type EnterResult =
  | { room: RoomState; playerId: string }
  | { error: string; access?: string }

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    const options = {
      autoConnect: false,
      withCredentials: true,
      path: '/poker/socket.io',
      transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
    }
    socket = SERVER_URL ? io(SERVER_URL, options) : io(options)
  }
  return socket
}

export function ensureSocketConnected(): Promise<Socket> {
  const s = getSocket()
  if (s.connected) return Promise.resolve(s)
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      cleanup()
      resolve(s)
    }
    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      s.off('connect', onConnect)
      s.off('connect_error', onError)
    }
    s.once('connect', onConnect)
    s.once('connect_error', onError)
    s.connect()
  })
}

export function disconnectSocket() {
  if (!socket) return
  socket.disconnect()
}

export function bindIdentity(_email?: string): Promise<{ ok?: boolean; error?: string }> {
  return ensureSocketConnected()
    .then(
      (s) =>
        new Promise<{ ok?: boolean; error?: string }>((resolve) => {
          s.emit('identity:bind', {}, (result: { ok?: boolean; error?: string }) => {
            resolve(result || { ok: true })
          })
        }),
    )
    .catch((err) => ({
      error: err instanceof Error ? err.message : 'Socket connection failed',
    }))
}

export function enterRoom(payload: {
  code: string
  name: string
  email?: string
  boardName?: string
  boardId?: number
}): Promise<EnterResult> {
  return ensureSocketConnected()
    .then(
      (s) =>
        new Promise<EnterResult>((resolve) => {
          s.emit(
            'room:enter',
            {
              code: payload.code,
              name: payload.name,
              boardName: payload.boardName,
              boardId: payload.boardId,
            },
            (result: EnterResult) => {
              resolve(result)
            },
          )
        }),
    )
    .catch((err) => ({
      error: err instanceof Error ? err.message : 'Socket connection failed',
    }))
}

export function selectTicket(payload: {
  key: string
  summary: string
  url: string
}): Promise<{ ok?: boolean; error?: string; room?: RoomState }> {
  return new Promise((resolve) => {
    getSocket().emit(
      'ticket:select',
      payload,
      (result: { ok?: boolean; error?: string; room?: RoomState }) => {
        resolve(result || { ok: true })
      },
    )
  })
}

export function setTopic(topic: string) {
  getSocket().emit('room:topic', { topic })
}

export function castVote(value: string) {
  getSocket().emit('vote:cast', { value })
}

export function clearVote() {
  getSocket().emit('vote:clear')
}

export function revealRound() {
  getSocket().emit('round:reveal')
}

export function resetRound() {
  getSocket().emit('round:reset')
}

export function leaveRoomSocket() {
  getSocket().emit('room:leave')
}
