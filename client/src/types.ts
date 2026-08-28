export const POINT_VALUES = [
  '0',
  '½',
  '1',
  '2',
  '3',
  '5',
  '8',
  '13',
  '21',
  '34',
  '?',
  '☕',
] as const

export type PointValue = (typeof POINT_VALUES)[number]

export type PublicPlayer = {
  id: string
  email?: string
  name: string
  hasVoted: boolean
  vote: string | null
  isHost: boolean
}

export type PendingMember = {
  email: string
  displayName: string
  role: string
  status: string
  updatedAt: string
}

export type SelectedTicket = {
  key: string
  summary: string
  url: string
}

export const DRAW_COLORS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#0f172a',
] as const

export const DEFAULT_DRAW_COLOR = DRAW_COLORS[0]

export type DrawPoint = { x: number; y: number }

export type DrawStroke = {
  id: string
  ticketKey: string
  color: string
  points: DrawPoint[]
}

export type RoomState = {
  code: string
  boardName?: string
  boardId?: number | null
  topic: string
  revealed: boolean
  selectedTicket?: SelectedTicket | null
  players: PublicPlayer[]
  voters?: PublicPlayer[]
  pending?: PendingMember[]
  strokes?: DrawStroke[]
  voteDeadline?: number | null
}

export const TIMER_SECONDS = [30, 60] as const
export type TimerSeconds = (typeof TIMER_SECONDS)[number]

export type PlanningIssue = {
  key: string
  summary: string
  status: string
  statusCategory?: string
  issuetype: string
  assignee?: string | null
  url: string
  platforms?: string[]
  storyPoints?: number | null
}

export type PlanningGroup = {
  id: number
  name: string
  state?: string
  issues: PlanningIssue[]
}

export type PlanningData = {
  boardId: number
  activeSprints?: PlanningGroup[]
  previousSprint: PlanningGroup | null
  backlogGroups: PlanningGroup[]
}

export function voterList(room: RoomState): PublicPlayer[] {
  return room.voters || room.players.filter((p) => !p.isHost)
}

const BOARD_NUMERIC_POINTS: { label: string; value: number }[] = [
  { label: '0', value: 0 },
  { label: '½', value: 0.5 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '8', value: 8 },
  { label: '13', value: 13 },
  { label: '21', value: 21 },
  { label: '34', value: 34 },
]

const VOTE_TO_NUMBER: Record<string, number> = Object.fromEntries(
  BOARD_NUMERIC_POINTS.map((point) => [point.label, point.value]),
)

export function numericVotes(players: PublicPlayer[]): number[] {
  return players
    .map((player) => (player.vote ? VOTE_TO_NUMBER[player.vote] : undefined))
    .filter((value): value is number => value !== undefined)
}

function nearestBoardPoint(avg: number): string {
  let best = BOARD_NUMERIC_POINTS[0]
  let bestDist = Math.abs(avg - best.value)

  for (let i = 1; i < BOARD_NUMERIC_POINTS.length; i += 1) {
    const point = BOARD_NUMERIC_POINTS[i]
    const dist = Math.abs(avg - point.value)
    if (dist < bestDist || (dist === bestDist && point.value > best.value)) {
      best = point
      bestDist = dist
    }
  }

  return best.label
}

export function averageVote(players: PublicPlayer[]): string | null {
  const values = numericVotes(players)
  if (values.length === 0) return null
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length
  return nearestBoardPoint(avg)
}

export function pointLabelToNumber(label: string | null | undefined): number | null {
  if (!label) return null
  const value = VOTE_TO_NUMBER[label]
  return value === undefined ? null : value
}

export function parseStoryPointsInput(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const text = raw.trim()
  if (!text) return null
  const fromLabel = pointLabelToNumber(text)
  if (fromLabel != null) return fromLabel
  if (text === '1/2' || text === '0.5') return 0.5
  const num = Number(text)
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

export function consensusLabel(players: PublicPlayer[]): string | null {
  const votes = players.map((p) => p.vote).filter(Boolean) as string[]
  if (votes.length === 0) return null
  const unique = new Set(votes)
  if (unique.size === 1) return 'Unanimous'
  if (unique.size === 2) return 'Close'
  return 'Spread'
}

export type VoteTallyRow = {
  label: string
  count: number
}

export function voteTally(players: PublicPlayer[]): VoteTallyRow[] {
  const counts = new Map<string, number>()
  for (const player of players) {
    if (!player.vote) continue
    counts.set(player.vote, (counts.get(player.vote) || 0) + 1)
  }
  const rows: VoteTallyRow[] = []
  for (const label of POINT_VALUES) {
    const count = counts.get(label)
    if (count) rows.push({ label, count })
  }
  for (const [label, count] of counts) {
    if (!(POINT_VALUES as readonly string[]).includes(label)) {
      rows.push({ label, count })
    }
  }
  return rows
}

export function countVotesMatching(
  players: PublicPlayer[],
  points: number | null,
  label?: string | null,
): number {
  const trimmed = String(label ?? '').trim()
  if (points == null && !trimmed) return 0
  let count = 0
  for (const player of players) {
    if (!player.vote) continue
    if (trimmed && player.vote === trimmed) {
      count += 1
      continue
    }
    if (points == null) continue
    const votePoints = parseStoryPointsInput(player.vote)
    if (votePoints != null && votePoints === points) count += 1
  }
  return count
}
