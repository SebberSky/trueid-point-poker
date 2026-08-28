import { io, type Socket } from 'socket.io-client'
import type { DrawStroke, RoomState } from './types'

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
      transports: ['polling', 'websocket'] as ('websocket' | 'polling')[],
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
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Socket connection failed'))
    }, 8000)
    const cleanup = () => {
      window.clearTimeout(timer)
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
  return ensureSocketConnected().then(
    (s) =>
      new Promise((resolve) => {
        s.emit(
          'ticket:select',
          payload,
          (result: { ok?: boolean; error?: string; room?: RoomState }) => {
            resolve(result || { ok: true })
          },
        )
      }),
  )
}

export function setTopic(topic: string) {
  void ensureSocketConnected().then((s) => s.emit('room:topic', { topic }))
}

export function castVote(value: string) {
  return ensureSocketConnected().then(
    (s) =>
      new Promise<{ ok?: boolean; error?: string }>((resolve) => {
        s.emit('vote:cast', { value }, (result: { ok?: boolean; error?: string }) => {
          resolve(result || { ok: true })
        })
      }),
  )
}

export function clearVote() {
  return ensureSocketConnected().then(
    (s) =>
      new Promise<{ ok?: boolean; error?: string }>((resolve) => {
        s.emit('vote:clear', (result: { ok?: boolean; error?: string }) => {
          resolve(result || { ok: true })
        })
      }),
  )
}

export function revealRound() {
  void ensureSocketConnected().then((s) => s.emit('round:reveal'))
}

export function startVoteTimer(seconds: number) {
  return ensureSocketConnected().then(
    (s) =>
      new Promise<{ ok?: boolean; error?: string; voteDeadline?: number }>(
        (resolve) => {
          s.emit(
            'vote:timer-start',
            { seconds },
            (result: {
              ok?: boolean
              error?: string
              voteDeadline?: number
            }) => {
              resolve(result || { ok: true })
            },
          )
        },
      ),
  )
}

export function resetRound() {
  void ensureSocketConnected().then((s) => s.emit('round:reset'))
}

export function leaveRoomSocket() {
  getSocket().emit('room:leave')
}

export function emitDrawStroke(stroke: DrawStroke) {
  void ensureSocketConnected().then((s) => s.emit('draw:stroke', { stroke }))
}

export function emitDrawRemove(id: string) {
  void ensureSocketConnected().then((s) => s.emit('draw:remove', { id }))
}
