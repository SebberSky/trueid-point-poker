import { io, type Socket } from 'socket.io-client'
import type { RoomState } from './types'

const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined

export type EnterResult =
  | { room: RoomState; playerId: string }
  | { error: string; access?: string }

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    const base = String(import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
    const options = {
      autoConnect: true,
      path: `${base}/socket.io`,
      transports: ['websocket', 'polling'] as ('websocket' | 'polling')[],
    }
    socket = SERVER_URL ? io(SERVER_URL, options) : io(options)
  }
  return socket
}

export function bindIdentity(email: string): Promise<{ ok?: boolean; error?: string }> {
  return new Promise((resolve) => {
    getSocket().emit('identity:bind', { email }, (result: { ok?: boolean; error?: string }) => {
      resolve(result || { ok: true })
    })
  })
}

export function enterRoom(payload: {
  code: string
  name: string
  email: string
  boardName?: string
  boardId?: number
}): Promise<EnterResult> {
  return new Promise((resolve) => {
    getSocket().emit('room:enter', payload, (result: EnterResult) => {
      resolve(result)
    })
  })
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
