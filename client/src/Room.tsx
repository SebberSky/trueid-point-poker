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
  searchIssuesBySummary,
  setIssueStoryPoints,
  rankIssue,
} from './jiraApi'
import { TicketViewer } from './TicketViewer'
import { CardArt, CardBackArt, cardTheme } from './CardArt'
import {
  POINT_VALUES,
  averageVote,
  parseStoryPointsInput,
  voterList,
  type PendingMember,
  type PlanningData,
  type PlanningGroup,
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
  const [ticketRefreshKey, setTicketRefreshKey] = useState(0)
  const [sameTitleOpen, setSameTitleOpen] = useState(false)
  const [sameTitleIssues, setSameTitleIssues] = useState<PlanningIssue[]>([])
  const [sameTitleKey, setSameTitleKey] = useState<string | null>(null)
  const [sameTitleBusy, setSameTitleBusy] = useState(false)
  const [sameTitleDialogOpen, setSameTitleDialogOpen] = useState(false)
  const [applyPoints, setApplyPoints] = useState('')
  const [checkedKeys, setCheckedKeys] = useState<string[]>([])
  const [ticketRailWide, setTicketRailWide] = useState(false)
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
    if (room.revealed && me?.vote) {
      setLocalVote(me.vote)
      return
    }
    if (!room.revealed && me && !me.hasVoted) {
      setLocalVote(null)
    }
  }, [room.revealed, room.selectedTicket?.key, me?.hasVoted, me?.vote])

  useEffect(() => {
    if (room.revealed && !wasRevealedRef.current) {
      setHostPoints((prev) => {
        if (prev) return prev
        const points = parseStoryPointsInput(avg)
        return points == null ? null : String(points)
      })
    }
    wasRevealedRef.current = room.revealed
  }, [room.revealed, avg])

  useEffect(() => {
    setHostPoints(null)
  }, [selected?.key])

  useEffect(() => {
    setSameTitleOpen(false)
    setSameTitleIssues([])
    setSameTitleKey(null)
    setSameTitleBusy(false)
    setSameTitleDialogOpen(false)
    setApplyPoints('')
    setStoryPointError(null)
  }, [room.revealed, selected?.key])

  useEffect(() => {
    if (!sameTitleDialogOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSameTitleDialogOpen(false)
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [sameTitleDialogOpen])

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
      void clearVote()
      return
    }
    setLocalVote(value)
    void castVote(value)
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

  function handleApplyPointsChange(raw: string) {
    if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
      setApplyPoints(raw)
    }
  }

  async function handleSetStoryPoint() {
    if (!selected?.key || storyPointsValue == null) return
    setStoryPointBusy(true)
    setStoryPointError(null)
    const pointsText = String(storyPointsValue)
    setApplyPoints(pointsText)
    setSameTitleKey(null)
    setSameTitleOpen(true)
    setSameTitleDialogOpen(true)
    setSameTitleIssues([])
    try {
      await setIssueStoryPoints({
        key: selected.key,
        points: storyPointsValue,
        roomId: room.code,
        boardId: room.boardId,
      })
      patchPlanningIssuePoints(selected.key, storyPointsValue)
      setTicketRefreshKey((n) => n + 1)
    } catch (err) {
      setStoryPointError(
        err instanceof Error ? err.message : 'Failed to set story points',
      )
    } finally {
      setStoryPointBusy(false)
    }

    setSameTitleBusy(true)
    try {
      const data = await searchIssuesBySummary({
        summary: selected.summary,
        excludeKey: selected.key,
        roomId: room.code,
      })
      const issues = (data.issues || []).filter(
        (issue) => issue.key !== selected.key,
      )
      setSameTitleIssues(issues)
      setSameTitleKey(issues[0]?.key || null)
      setSameTitleDialogOpen(issues.length > 0)
    } catch (err) {
      setSameTitleIssues([])
      setSameTitleKey(null)
      setSameTitleDialogOpen(false)
      setStoryPointError(
        err instanceof Error ? err.message : 'Failed to find matching tickets',
      )
    } finally {
      setSameTitleBusy(false)
    }
  }

  async function handleApplySameTitlePoints() {
    const points = parseStoryPointsInput(applyPoints)
    if (!sameTitleKey || points == null || storyPointBusy) return
    setStoryPointBusy(true)
    setStoryPointError(null)
    try {
      await setIssueStoryPoints({
        key: sameTitleKey,
        points,
        roomId: room.code,
        boardId: room.boardId,
      })
      const remaining = sameTitleIssues.filter(
        (issue) => issue.key !== sameTitleKey,
      )
      setSameTitleIssues(remaining)
      setSameTitleKey(remaining[0]?.key || null)
    } catch (err) {
      setStoryPointError(
        err instanceof Error ? err.message : 'Failed to set story points',
      )
    } finally {
      setStoryPointBusy(false)
    }
  }

  const allPlanningIssues = useMemo(() => {
    if (!planning) return []
    return [
      ...(planning.activeSprints || []).flatMap((group) => group.issues),
      ...planning.backlogGroups.flatMap((group) => group.issues),
      ...(planning.previousSprint?.issues || []),
    ]
  }, [planning])

  const checkedSet = useMemo(() => new Set(checkedKeys), [checkedKeys])
  const selectedPointsTotal = useMemo(() => {
    const byKey = new Map<string, PlanningIssue>()
    for (const issue of allPlanningIssues) byKey.set(issue.key, issue)
    for (const issue of searchResults || []) byKey.set(issue.key, issue)
    return sumStoryPoints(
      [...checkedSet]
        .map((key) => byKey.get(key))
        .filter((issue): issue is PlanningIssue => Boolean(issue)),
    )
  }, [allPlanningIssues, checkedSet, searchResults])

  function patchPlanningIssuePoints(key: string, points: number) {
    setPlanning((prev) => {
      if (!prev) return prev
      const patch = (issues: PlanningIssue[]) =>
        issues.map((issue) =>
          issue.key === key ? { ...issue, storyPoints: points } : issue,
        )
      return {
        ...prev,
        activeSprints: (prev.activeSprints || []).map((group) => ({
          ...group,
          issues: patch(group.issues),
        })),
        backlogGroups: prev.backlogGroups.map((group) => ({
          ...group,
          issues: patch(group.issues),
        })),
        previousSprint: prev.previousSprint
          ? {
              ...prev.previousSprint,
              issues: patch(prev.previousSprint.issues),
            }
          : null,
      }
    })
  }

  function replaceGroupIssues(groupId: string, issues: PlanningIssue[]) {
    setPlanning((prev) => {
      if (!prev) return prev
      const match = (group: PlanningGroup) =>
        String(group.id) === groupId ? { ...group, issues } : group
      return {
        ...prev,
        activeSprints: (prev.activeSprints || []).map(match),
        backlogGroups: prev.backlogGroups.map(match),
        previousSprint:
          prev.previousSprint && String(prev.previousSprint.id) === groupId
            ? { ...prev.previousSprint, issues }
            : prev.previousSprint,
      }
    })
  }

  function toggleCheckedKey(key: string) {
    setCheckedKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    )
  }

  function toggleCheckedGroup(keys: string[], selectAll: boolean) {
    setCheckedKeys((prev) => {
      const drop = new Set(keys)
      const kept = prev.filter((key) => !drop.has(key))
      return selectAll ? [...kept, ...keys] : kept
    })
  }

  async function handleReorderIssues(
    groupId: string,
    issues: PlanningIssue[],
    fromKey: string,
    toKey: string,
  ) {
    const next = moveIssueInList(issues, fromKey, toKey)
    if (!next) return
    const newIndex = next.findIndex((issue) => issue.key === fromKey)
    if (newIndex < 0) return
    const rankBeforeIssue = newIndex === 0 ? next[1]?.key : undefined
    const rankAfterIssue = newIndex === 0 ? undefined : next[newIndex - 1]?.key
    if (!rankBeforeIssue && !rankAfterIssue) return
    replaceGroupIssues(groupId, next)
    setActionError(null)
    try {
      await rankIssue({
        key: fromKey,
        roomId: room.code,
        ...(rankBeforeIssue
          ? { rankBeforeIssue }
          : { rankAfterIssue }),
      })
    } catch (err) {
      replaceGroupIssues(groupId, issues)
      setActionError(err instanceof Error ? err.message : 'Failed to reorder')
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
                canEdit={isHost}
                fallbackSummary={selected.summary}
                fallbackUrl={selected.url}
                refreshKey={ticketRefreshKey}
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
          <aside
            className={`ticket-rail float-panel${ticketRailWide ? ' is-wide' : ''}`}
            aria-label="Planning tickets"
          >
            <div className="rail-head">
              <h2>Tickets</h2>
              <button
                type="button"
                className="ghost rail-wide-btn"
                onClick={() => setTicketRailWide((open) => !open)}
                aria-pressed={ticketRailWide}
              >
                {ticketRailWide ? 'Exit full width' : 'Full width'}
              </button>
            </div>
            {checkedKeys.length > 0 ? (
              <p className="selected-points">
                Selected {checkedKeys.length} · {formatStoryPoints(selectedPointsTotal)} pts
              </p>
            ) : null}
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
            <div className="ticket-rail-scroll">
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
                      checkedKeys={checkedSet}
                      onToggleChecked={toggleCheckedKey}
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
                  <TicketGroupBlock
                    key={`active-${group.id}`}
                    group={group}
                    heading={`Active · ${group.name}`}
                    open={openGroups[`active-${group.id}`] ?? true}
                    onOpenChange={(open) =>
                      setOpenGroups((prev) => ({
                        ...prev,
                        [`active-${group.id}`]: open,
                      }))
                    }
                    selectedKey={selected?.key}
                    checkedKeys={checkedSet}
                    onToggleChecked={toggleCheckedKey}
                    onToggleGroup={toggleCheckedGroup}
                    onSelect={handleSelectIssue}
                    onReorder={(fromKey, toKey) =>
                      handleReorderIssues(String(group.id), group.issues, fromKey, toKey)
                    }
                  />
                ))}

                {planning?.backlogGroups.map((group) => (
                  <TicketGroupBlock
                    key={group.id}
                    group={group}
                    heading={group.name}
                    open={openGroups[String(group.id)] ?? true}
                    onOpenChange={(open) =>
                      setOpenGroups((prev) => ({
                        ...prev,
                        [String(group.id)]: open,
                      }))
                    }
                    selectedKey={selected?.key}
                    checkedKeys={checkedSet}
                    onToggleChecked={toggleCheckedKey}
                    onToggleGroup={toggleCheckedGroup}
                    onSelect={handleSelectIssue}
                    onReorder={(fromKey, toKey) =>
                      handleReorderIssues(String(group.id), group.issues, fromKey, toKey)
                    }
                  />
                ))}

                {planning?.previousSprint ? (
                  <TicketGroupBlock
                    group={planning.previousSprint}
                    heading={`Last sprint · ${planning.previousSprint.name}`}
                    open={prevOpen}
                    onOpenChange={setPrevOpen}
                    selectedKey={selected?.key}
                    checkedKeys={checkedSet}
                    onToggleChecked={toggleCheckedKey}
                    onToggleGroup={toggleCheckedGroup}
                    onSelect={handleSelectIssue}
                    onReorder={(fromKey, toKey) =>
                      handleReorderIssues(
                        String(planning.previousSprint?.id),
                        planning.previousSprint?.issues || [],
                        fromKey,
                        toKey,
                      )
                    }
                  />
                ) : null}
              </>
            )}
            </div>
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
            {voters.map((player, index) => {
              const shownVote = room.revealed ? player.vote : null
              const theme = shownVote ? cardTheme(shownVote) : null
              return (
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
                  <div
                    className={`card-face${theme ? ' illustrated' : ''}`}
                    style={
                      theme
                        ? { background: theme.bg, color: theme.ink }
                        : undefined
                    }
                  >
                    {shownVote ? (
                      <>
                        <CardArt value={shownVote} />
                        <span className="card-value">{shownVote}</span>
                      </>
                    ) : player.hasVoted ? (
                      <span className="card-back" aria-label="Voted">
                        <CardBackArt />
                      </span>
                    ) : (
                      <span className="card-empty">…</span>
                    )}
                  </div>
                  <p className="seat-name">{player.name}</p>
                </article>
              )
            })}
          </section>

          {isHost ? (
            <section className="host-point-box">
              <label>
                Story points
                <input
                  className="avg-input"
                  value={hostPoints ?? ''}
                  onChange={(event) =>
                    handleHostPointsChange(event.target.value)
                  }
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  placeholder="—"
                  aria-label="Story points"
                />
              </label>
              {!sameTitleOpen ? (
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
              ) : sameTitleBusy ? (
                <p className="field-hint">Finding matching tickets…</p>
              ) : sameTitleIssues.length > 0 && !sameTitleDialogOpen ? (
                <button
                  type="button"
                  className="cta secondary"
                  onClick={() => setSameTitleDialogOpen(true)}
                >
                  Similar tickets ({sameTitleIssues.length})
                </button>
              ) : sameTitleIssues.length === 0 ? (
                <p className="ticket-empty-mini">No other tickets</p>
              ) : null}
            </section>
          ) : null}

          {room.revealed ? (
            <section className="results compact" aria-live="polite">
              <div>
                <span>Average</span>
                <strong>{avg ?? '—'}</strong>
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
                <button
                  type="button"
                  className="ghost"
                  onClick={resetRound}
                  disabled={storyPointBusy}
                >
                  Next round
                </button>
              )}
            </section>
          ) : (
            <section className="hand" aria-label="Your cards">
              {POINT_VALUES.map((value) => {
                const theme = cardTheme(value)
                return (
                  <button
                    key={value}
                    type="button"
                    className={`point-card ${localVote === value ? 'selected' : ''}`}
                    style={{ background: theme.bg, color: theme.ink }}
                    disabled={room.revealed}
                    onClick={() => handleVote(value)}
                    aria-label={`Vote ${value}`}
                  >
                    <CardArt value={value} />
                    <span className="point-card-label">{value}</span>
                  </button>
                )
              })}
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

      {isHost && sameTitleDialogOpen ? (
        <div
          className="same-title-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Similar tickets"
          onClick={() => setSameTitleDialogOpen(false)}
        >
          <div
            className="same-title-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="same-title-dialog-head">
              <div>
                <h2>Similar tickets</h2>
                <p>
                  {sameTitleBusy
                    ? 'Finding matching tickets…'
                    : `${sameTitleIssues.length} with the same title`}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setSameTitleDialogOpen(false)}
              >
                Close
              </button>
            </header>
            <div className="same-title-dialog-main">
              <aside className="same-title-dialog-list">
                {sameTitleIssues.length === 0 && !sameTitleBusy ? (
                  <p className="ticket-empty-mini">No other tickets</p>
                ) : (
                  <ul className="same-title-list">
                    {sameTitleIssues.map((issue) => {
                      const picked = sameTitleKey === issue.key
                      return (
                        <li key={issue.key}>
                          <button
                            type="button"
                            className={picked ? 'active' : ''}
                            aria-pressed={picked}
                            onClick={() => setSameTitleKey(issue.key)}
                          >
                            <span className="same-title-choice">
                              <span
                                className={`same-title-radio${picked ? ' is-on' : ''}`}
                              />
                              <span className={picked ? 'same-title-picked' : 'same-title-pick'}>
                                {picked ? 'Selected' : 'Select'}
                              </span>
                            </span>
                            <span className="ticket-list-keyrow">
                              <strong>{issue.key}</strong>
                              {issue.platforms?.length ? (
                                <span className="same-title-platform">
                                  {issue.platforms.join(', ')}
                                </span>
                              ) : null}
                            </span>
                            <em>{issue.summary}</em>
                            {issue.status ? (
                              <span className="same-title-status">
                                {issue.status}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </aside>
              <div className="same-title-preview">
                {sameTitleKey ? (
                  <TicketViewer
                    key={sameTitleKey}
                    issueKey={sameTitleKey}
                    roomId={room.code}
                    canEdit={false}
                    fallbackSummary={
                      sameTitleIssues.find((issue) => issue.key === sameTitleKey)
                        ?.summary || ''
                    }
                    fallbackUrl={
                      sameTitleIssues.find((issue) => issue.key === sameTitleKey)
                        ?.url || ''
                    }
                  />
                ) : (
                  <p className="ticket-empty-mini">Select a ticket to preview</p>
                )}
              </div>
            </div>
            {sameTitleIssues.length > 0 ? (
              <footer className="same-title-dialog-foot">
                {storyPointError ? (
                  <p className="form-error">{storyPointError}</p>
                ) : null}
                <div className="same-title-apply">
                  <input
                    className="same-title-points"
                    value={applyPoints}
                    onChange={(event) =>
                      handleApplyPointsChange(event.target.value)
                    }
                    inputMode="decimal"
                    pattern="[0-9]*[.]?[0-9]*"
                    aria-label="Story points"
                  />
                  <button
                    type="button"
                    className="cta secondary"
                    onClick={handleApplySameTitlePoints}
                    disabled={
                      storyPointBusy ||
                      !sameTitleKey ||
                      parseStoryPointsInput(applyPoints) == null
                    }
                  >
                    {storyPointBusy
                      ? 'Setting…'
                      : sameTitleKey
                        ? `Set point on ${sameTitleKey}`
                        : 'Set point'}
                  </button>
                </div>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TicketGroupBlock({
  group,
  heading,
  open,
  onOpenChange,
  selectedKey,
  checkedKeys,
  onToggleChecked,
  onToggleGroup,
  onSelect,
  onReorder,
}: {
  group: PlanningGroup
  heading: string
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedKey?: string
  checkedKeys: Set<string>
  onToggleChecked: (key: string) => void
  onToggleGroup: (keys: string[], selectAll: boolean) => void
  onSelect: (issue: PlanningIssue) => void
  onReorder: (fromKey: string, toKey: string) => void
}) {
  const keys = group.issues.map((issue) => issue.key)
  const selectedCount = keys.filter((key) => checkedKeys.has(key)).length
  const allOn = keys.length > 0 && selectedCount === keys.length
  const someOn = selectedCount > 0 && !allOn
  const points = sumStoryPoints(group.issues)

  return (
    <details
      className="ticket-group"
      open={open}
      onToggle={(e) => {
        const el = e.target as HTMLDetailsElement
        onOpenChange(Boolean(el?.open))
      }}
    >
      <summary
        onClick={(event) => {
          const target = event.target as HTMLElement
          if (target.closest('.ticket-group-check')) {
            event.preventDefault()
          }
        }}
      >
        <label
          className="ticket-group-check"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={allOn}
            ref={(el) => {
              if (el) el.indeterminate = someOn
            }}
            onChange={() => onToggleGroup(keys, !allOn)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select all in ${heading}`}
          />
        </label>
        <span className="ticket-group-title">{heading}</span>
        <span>
          {formatStoryPoints(points)} pts · {group.issues.length}
        </span>
      </summary>
      <TicketList
        issues={group.issues}
        selectedKey={selectedKey}
        checkedKeys={checkedKeys}
        onToggleChecked={onToggleChecked}
        onSelect={onSelect}
        onReorder={onReorder}
      />
    </details>
  )
}

function TicketList({
  issues,
  selectedKey,
  checkedKeys,
  onToggleChecked,
  onSelect,
  onReorder,
  showAssignee = false,
}: {
  issues: PlanningIssue[]
  selectedKey?: string
  checkedKeys: Set<string>
  onToggleChecked: (key: string) => void
  onSelect: (issue: PlanningIssue) => void
  onReorder?: (fromKey: string, toKey: string) => void
  showAssignee?: boolean
}) {
  if (issues.length === 0) {
    return <p className="ticket-empty-mini">No tickets</p>
  }
  return (
    <ul className="ticket-list">
      {issues.map((issue) => (
        <li
          key={issue.key}
          className="ticket-row"
          draggable={Boolean(onReorder)}
          onDragStart={(event) => {
            if (!onReorder) return
            event.dataTransfer.setData('text/plain', issue.key)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            if (!onReorder) return
            event.preventDefault()
          }}
          onDrop={(event) => {
            if (!onReorder) return
            event.preventDefault()
            const fromKey = event.dataTransfer.getData('text/plain')
            if (fromKey) onReorder(fromKey, issue.key)
          }}
        >
          <label
            className="ticket-check"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={checkedKeys.has(issue.key)}
              onChange={() => onToggleChecked(issue.key)}
              aria-label={`Select ${issue.key}`}
            />
          </label>
          <button
            type="button"
            className={selectedKey === issue.key ? 'active' : ''}
            onClick={() => onSelect(issue)}
          >
            <span className="ticket-list-keyrow">
              <strong>{issue.key}</strong>
              <span className="ticket-list-points">
                {formatStoryPoints(issue.storyPoints)}
              </span>
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

function formatStoryPoints(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0.5) return '½'
  return Number.isInteger(value) ? String(value) : String(value)
}

function sumStoryPoints(issues: PlanningIssue[]) {
  return issues.reduce((sum, issue) => {
    const value = issue.storyPoints
    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  }, 0)
}

function moveIssueInList(
  issues: PlanningIssue[],
  fromKey: string,
  toKey: string,
) {
  if (fromKey === toKey) return null
  const fromIdx = issues.findIndex((issue) => issue.key === fromKey)
  const toIdx = issues.findIndex((issue) => issue.key === toKey)
  if (fromIdx < 0 || toIdx < 0) return null
  const next = [...issues]
  const [item] = next.splice(fromIdx, 1)
  next.splice(toIdx, 0, item)
  return next
}
