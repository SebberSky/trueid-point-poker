import { useEffect, useMemo, useRef, useState } from 'react'
import {
  castVote,
  clearVote,
  getSocket,
  resetRound,
  revealRound,
  selectTicket,
} from './socket'
import {
  approveRoomMember,
  denyRoomMember,
  fetchPlanningTickets,
  searchIssues,
  setIssueStoryPoints,
} from './jiraApi'
import { TicketViewer } from './TicketViewer'
import {
  POINT_VALUES,
  averageVote,
  parseStoryPointsInput,
  voterList,
  type PendingMember,
  type PlanningData,
  type PlanningIssue,
  type RoomState,
} from './types'

type RoomProps = {
  room: RoomState
  playerId: string
  onRoomUpdate: (room: RoomState) => void
  onLeave: () => void
}

export function Room({ room, playerId, onRoomUpdate, onLeave }: RoomProps) {
  const [localVote, setLocalVote] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingMember[]>(room.pending || [])
  const [actionError, setActionError] = useState<string | null>(null)
  const [planning, setPlanning] = useState<PlanningData | null>(null)
  const [planningError, setPlanningError] = useState<string | null>(null)
  const [planningBusy, setPlanningBusy] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [ticketQuery, setTicketQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlanningIssue[] | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [ticketRailOpen, setTicketRailOpen] = useState(true)
  const [voteRailOpen, setVoteRailOpen] = useState(true)
  const [storyPointBusy, setStoryPointBusy] = useState(false)
  const [storyPointError, setStoryPointError] = useState<string | null>(null)
  const [hostPoints, setHostPoints] = useState<string | null>(null)
  const wasRevealedRef = useRef(false)

  const me = room.players.find((player) => player.id === playerId)
  const isHost = Boolean(me?.isHost)
  const panelsOpen = isHost ? ticketRailOpen || voteRailOpen : voteRailOpen
  const voters = useMemo(() => voterList(room), [room])
  const votedCount = voters.filter((p) => p.hasVoted).length
  const avg = useMemo(() => averageVote(voters), [voters])
  const storyPointsLabel = isHost ? hostPoints : avg
  const storyPointsValue = parseStoryPointsInput(storyPointsLabel)

  function togglePanels() {
    const next = !panelsOpen
    if (isHost) setTicketRailOpen(next)
    setVoteRailOpen(next)
  }

  const selected = room.selectedTicket

  useEffect(() => {
    setPending(room.pending || [])
  }, [room.pending])

  useEffect(() => {
    if (!me?.hasVoted) setLocalVote(null)
    if (room.revealed && me?.vote) setLocalVote(me.vote)
  }, [room, playerId, me])

  useEffect(() => {
    if (room.revealed && !wasRevealedRef.current) {
      const points = parseStoryPointsInput(avg)
      setHostPoints(points == null ? null : String(points))
    }
    if (!room.revealed) setHostPoints(null)
    wasRevealedRef.current = room.revealed
  }, [room.revealed, avg])

  function handleHostPointsChange(raw: string) {
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      setHostPoints(raw)
    }
  }

  useEffect(() => {
    const socket = getSocket()
    const onPending = (payload: { roomId?: string; pending?: PendingMember[] }) => {
      if (payload.roomId && payload.roomId !== room.code) return
      if (payload.pending) setPending(payload.pending)
    }
    socket.on('access:pending-updated', onPending)
    return () => {
      socket.off('access:pending-updated', onPending)
    }
  }, [room.code])

  useEffect(() => {
    if (!isHost || !room.boardId) return
    let cancelled = false
    setPlanningBusy(true)
    setPlanningError(null)
    fetchPlanningTickets(room.boardId, room.code)
      .then((data) => {
        if (cancelled) return
        setPlanning(data)
        const defaults: Record<string, boolean> = {}
        for (const group of data.activeSprints || []) {
          defaults[`active-${group.id}`] = true
        }
        for (const group of data.backlogGroups) {
          defaults[String(group.id)] = true
        }
        setOpenGroups(defaults)
      })
      .catch((err) => {
        if (!cancelled) {
          setPlanningError(err instanceof Error ? err.message : 'Failed to load tickets')
        }
      })
      .finally(() => {
        if (!cancelled) setPlanningBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [isHost, room.boardId, room.code])

  useEffect(() => {
    if (!isHost) return
    const q = ticketQuery.trim()
    if (!q) {
      setSearchResults(null)
      setSearchError(null)
      setSearchBusy(false)
      return
    }
    let cancelled = false
    setSearchBusy(true)
    setSearchError(null)
    const timer = window.setTimeout(() => {
      searchIssues(q, room.code)
        .then((data) => {
          if (!cancelled) setSearchResults(data.issues)
        })
        .catch((err) => {
          if (!cancelled) {
            setSearchResults([])
            setSearchError(err instanceof Error ? err.message : 'Search failed')
          }
        })
        .finally(() => {
          if (!cancelled) setSearchBusy(false)
        })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [isHost, ticketQuery, room.code])

  function handleVote(value: string) {
    if (isHost || room.revealed) return
    if (localVote === value) {
      setLocalVote(null)
      clearVote()
      return
    }
    setLocalVote(value)
    castVote(value)
  }

  async function handleApprove(email: string) {
    setActionError(null)
    try {
      const data = await approveRoomMember({
        roomId: room.code,
        email,
      })
      setPending(data.pending || [])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Approve failed')
    }
  }

  async function handleDeny(email: string) {
    setActionError(null)
    try {
      const data = await denyRoomMember({
        roomId: room.code,
        email,
      })
      setPending(data.pending || [])
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Deny failed')
    }
  }

  async function handleSetStoryPoint() {
    if (!selected?.key || storyPointsValue == null) return
    setStoryPointBusy(true)
    setStoryPointError(null)
    try {
      await setIssueStoryPoints({
        key: selected.key,
        points: storyPointsValue,
        roomId: room.code,
        boardId: room.boardId,
      })
      resetRound()
    } catch (err) {
      setStoryPointError(
        err instanceof Error ? err.message : 'Failed to set story points',
      )
    } finally {
      setStoryPointBusy(false)
    }
  }

  async function handleSelectIssue(issue: PlanningIssue) {
    if (!isHost) return
    setActionError(null)
    const url =
      issue.url ||
      `https://truedmp.atlassian.net/browse/${encodeURIComponent(issue.key)}`
    const result = await selectTicket({
      key: issue.key,
      summary: issue.summary,
      url,
    })
    if (result?.error) {
      setActionError(result.error)
      return
    }
    if (result?.room) onRoomUpdate(result.room)
  }

  return (
    <div className={`table room-shell ${isHost ? 'host-layout' : 'voter-layout'}`}>
      <header className="table-top">
        <div className="table-brand">
          <span className="brand-mark">TrueID Point Poker</span>
          <button type="button" className="ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
        <button
          type="button"
          className={`ghost panel-toggle-center ${panelsOpen ? '' : 'is-off'}`}
          onClick={togglePanels}
          aria-pressed={panelsOpen}
        >
          {panelsOpen ? 'Hide panels' : 'Show panels'}
        </button>
        <div className="room-meta">
          <div className="room-code" aria-label={`Room ${room.code}`}>
            <span>Room</span>
            <strong>{room.code}</strong>
          </div>
          {selected?.url ? (
            <a
              className="ghost open-jira"
              href={selected.url}
              target="_blank"
              rel="noreferrer"
            >
              Open in Jira
            </a>
          ) : (
            <button type="button" className="ghost open-jira" disabled>
              Open in Jira
            </button>
          )}
        </div>
      </header>

      {isHost && pending.length > 0 ? (
        <section className="pending-panel">
          <h2>Waiting for approval</h2>
          {actionError ? <p className="form-error">{actionError}</p> : null}
          <ul>
            {pending.map((person) => (
              <li key={person.email}>
                <span>
                  <strong>{person.displayName}</strong>
                  <em>{person.email}</em>
                </span>
                <span className="pending-actions">
                  <button type="button" className="ghost" onClick={() => handleApprove(person.email)}>
                    Approve
                  </button>
                  <button type="button" className="ghost" onClick={() => handleDeny(person.email)}>
                    Deny
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="room-main">
        <section className="ticket-stage">
          {selected ? (
            <div className="ticket-frame-wrap">
              <TicketViewer
                key={selected.key}
                issueKey={selected.key}
                roomId={room.code}
                fallbackSummary={selected.summary}
                fallbackUrl={selected.url}
              />
            </div>
          ) : (
            <div className="ticket-empty">
              {isHost
                ? 'Select a ticket from the list to open it for the room.'
                : 'Waiting for the host to pick a ticket.'}
            </div>
          )}
        </section>

        {isHost && ticketRailOpen ? (
          <aside className="ticket-rail float-panel" aria-label="Planning tickets">
            <div className="rail-head">
              <h2>Tickets</h2>
            </div>
            {actionError ? <p className="form-error">{actionError}</p> : null}
            <label className="ticket-search">
              <span className="visually-hidden">Search tickets</span>
              <input
                type="search"
                placeholder="Search key, title, assignee…"
                value={ticketQuery}
                onChange={(e) => setTicketQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {ticketQuery.trim() ? (
              <>
                {searchBusy ? <p className="field-hint">Searching…</p> : null}
                {searchError ? <p className="form-error">{searchError}</p> : null}
                {!searchBusy && !searchError ? (
                  <div className="ticket-group ticket-search-results">
                    <div className="ticket-search-heading">
                      Results
                      <span>{searchResults?.length ?? 0}</span>
                    </div>
                    <TicketList
                      issues={searchResults || []}
                      selectedKey={selected?.key}
                      onSelect={handleSelectIssue}
                      showAssignee
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {planningBusy ? <p className="field-hint">Loading…</p> : null}
                {planningError ? <p className="form-error">{planningError}</p> : null}

                {planning?.activeSprints?.map((group) => (
                  <details
                    key={`active-${group.id}`}
                    className="ticket-group"
                    open={openGroups[`active-${group.id}`] ?? true}
                    onToggle={(e) => {
                      const el = e.target as HTMLDetailsElement
                      const open = Boolean(el?.open)
                      setOpenGroups((prev) => ({
                        ...prev,
                        [`active-${group.id}`]: open,
                      }))
                    }}
                  >
                    <summary>
                      Active · {group.name}
                      <span>{group.issues.length}</span>
                    </summary>
                    <TicketList
                      issues={group.issues}
                      selectedKey={selected?.key}
                      onSelect={handleSelectIssue}
                    />
                  </details>
                ))}

                {planning?.backlogGroups.map((group) => (
                  <details
                    key={group.id}
                    className="ticket-group"
                    open={openGroups[String(group.id)] ?? true}
                    onToggle={(e) => {
                      const el = e.target as HTMLDetailsElement
                      const open = Boolean(el?.open)
                      setOpenGroups((prev) => ({
                        ...prev,
                        [String(group.id)]: open,
                      }))
                    }}
                  >
                    <summary>
                      {group.name}
                      <span>{group.issues.length}</span>
                    </summary>
                    <TicketList
                      issues={group.issues}
                      selectedKey={selected?.key}
                      onSelect={handleSelectIssue}
                    />
                  </details>
                ))}

                {planning?.previousSprint ? (
                  <details
                    className="ticket-group"
                    open={prevOpen}
                    onToggle={(e) => {
                      const el = e.target as HTMLDetailsElement
                      setPrevOpen(Boolean(el?.open))
                    }}
                  >
                    <summary>
                      Last sprint · {planning.previousSprint.name}
                      <span>{planning.previousSprint.issues.length}</span>
                    </summary>
                    <TicketList
                      issues={planning.previousSprint.issues}
                      selectedKey={selected?.key}
                      onSelect={handleSelectIssue}
                    />
                  </details>
                ) : null}
              </>
            )}
          </aside>
        ) : null}

        {isHost && !ticketRailOpen ? (
          <button
            type="button"
            className="panel-edge panel-edge-left"
            onClick={togglePanels}
          >
            Tickets
          </button>
        ) : null}

        {voteRailOpen ? (
          <aside className="vote-rail float-panel" aria-label="Votes">
            <div className="rail-head">
              <div className="vote-progress">
                {votedCount}/{voters.length} voted
              </div>
            </div>

          <section className="players compact" aria-label="Voters">
            {voters.map((player, index) => (
              <article
                key={player.id}
                className={[
                  'seat',
                  player.hasVoted ? 'voted' : '',
                  room.revealed ? 'revealed' : '',
                  player.id === playerId ? 'me' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="card-face">
                  {room.revealed ? (
                    <span className="card-value">{player.vote ?? '—'}</span>
                  ) : player.hasVoted ? (
                    <span className="card-back" aria-label="Voted" />
                  ) : (
                    <span className="card-empty">…</span>
                  )}
                </div>
                <p className="seat-name">{player.name}</p>
              </article>
            ))}
          </section>

          {room.revealed ? (
            <section className="results compact" aria-live="polite">
              <div>
                <span>Average</span>
                {isHost && avg != null ? (
                  <input
                    className="avg-input"
                    value={hostPoints ?? ''}
                    onChange={(event) =>
                      handleHostPointsChange(event.target.value)
                    }
                    inputMode="decimal"
                    pattern="[0-9]*[.]?[0-9]*"
                    aria-label="Average story points"
                  />
                ) : (
                  <strong>{avg ?? '—'}</strong>
                )}
              </div>
            </section>
          ) : null}

          {isHost && storyPointError ? (
            <p className="form-error">{storyPointError}</p>
          ) : null}

          {isHost ? (
            <section className="controls">
              {!room.revealed ? (
                <button
                  type="button"
                  className="cta"
                  onClick={revealRound}
                  disabled={votedCount === 0}
                >
                  Reveal cards
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="cta secondary"
                    onClick={handleSetStoryPoint}
                    disabled={
                      storyPointBusy ||
                      !selected?.key ||
                      storyPointsValue == null
                    }
                  >
                    {storyPointBusy
                      ? 'Setting…'
                      : storyPointsLabel != null
                        ? `Set story point (${storyPointsLabel})`
                        : 'Set story point'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={resetRound}
                    disabled={storyPointBusy}
                  >
                    Next round
                  </button>
                </>
              )}
            </section>
          ) : (
            <section className="hand" aria-label="Your cards">
              {POINT_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`point-card ${localVote === value ? 'selected' : ''}`}
                  disabled={room.revealed || !selected}
                  onClick={() => handleVote(value)}
                >
                  {value}
                </button>
              ))}
            </section>
          )}
        </aside>
        ) : (
          <button
            type="button"
            className="panel-edge panel-edge-right"
            onClick={togglePanels}
          >
            <span className="panel-edge-label">Votes</span>
          </button>
        )}
      </div>
    </div>
  )
}

function TicketList({
  issues,
  selectedKey,
  onSelect,
  showAssignee = false,
}: {
  issues: PlanningIssue[]
  selectedKey?: string
  onSelect: (issue: PlanningIssue) => void
  showAssignee?: boolean
}) {
  if (issues.length === 0) {
    return <p className="ticket-empty-mini">No tickets</p>
  }
  return (
    <ul className="ticket-list">
      {issues.map((issue) => (
        <li key={issue.key}>
          <button
            type="button"
            className={selectedKey === issue.key ? 'active' : ''}
            onClick={() => onSelect(issue)}
          >
            <span className="ticket-list-keyrow">
              <strong>{issue.key}</strong>
              {issue.status ? (
                <span
                  className={`ticket-list-status cat-${issue.statusCategory || 'default'}`}
                >
                  {issue.status}
                </span>
              ) : null}
            </span>
            <em>{issue.summary}</em>
            {showAssignee ? (
              <span className="ticket-list-assignee">
                {issue.assignee || 'Unassigned'}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
