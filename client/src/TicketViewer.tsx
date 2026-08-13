import { useEffect, useId, useRef, useState } from 'react'
import { AdfDocument } from './AdfDocument'
import { appUrl } from './appUrl'
import {
  setIssueFixVersions,
  setIssueNeedQa,
  setIssuePlatforms,
} from './jiraApi'

export type IssueAttachment = {
  id: string
  filename: string
  mimeType: string
  size: number
  kind?: string
  isImage: boolean
  isVideo?: boolean
  isAudio?: boolean
  contentUrl: string
  thumbnailUrl: string
}

export type IssueDetails = {
  key: string
  url: string
  summary: string
  description: unknown
  descriptionHtml?: string | null
  status: string
  statusCategory?: string
  issuetype: string
  issuetypeIcon?: string | null
  priority: string
  assignee: { displayName: string; avatarUrl?: string | null } | null
  platforms: string[]
  platformOptions?: string[]
  fixVersions: string[]
  fixVersionOptions?: string[]
  needQa?: string | null
  storyPoints?: number | null
  labels: string[]
  components: string[]
  parent: { key: string; summary: string } | null
  created: string | null
  updated: string | null
  attachments?: IssueAttachment[]
  mediaIndex?: Record<
    string,
    { url: string; mimeType?: string; filename?: string; kind?: string }
  >
  mediaUrls?: Record<string, string>
  comments: Array<{
    id: string
    created: string
    author: string
    body: unknown
    bodyHtml?: string | null
  }>
}

export async function fetchIssueDetails(
  key: string,
  roomId?: string,
): Promise<IssueDetails> {
  const qs = roomId
    ? `?roomId=${encodeURIComponent(roomId.trim().toUpperCase())}`
    : ''
  const res = await fetch(appUrl(`/api/issues/${encodeURIComponent(key)}${qs}`))
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || 'Failed to load issue')
  return data as IssueDetails
}

type TicketViewerProps = {
  issueKey: string
  roomId?: string
  canEdit?: boolean
  fallbackSummary?: string
  fallbackUrl?: string
  refreshKey?: number
}

const NEED_QA_CHOICES = ['Yes', 'No'] as const

export function TicketViewer({
  issueKey,
  roomId,
  canEdit = false,
  fallbackSummary = '',
  fallbackUrl = '',
  refreshKey = 0,
}: TicketViewerProps) {
  const [issue, setIssue] = useState<IssueDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [needQa, setNeedQa] = useState<string | null>(null)
  const [needQaBusy, setNeedQaBusy] = useState(false)
  const [needQaError, setNeedQaError] = useState<string | null>(null)
  const [platforms, setPlatforms] = useState<string[]>([])
  const [fixVersions, setFixVersions] = useState<string[]>([])
  const [metaBusy, setMetaBusy] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)
  const loadedKeyRef = useRef('')

  useEffect(() => {
    let cancelled = false
    const silent = loadedKeyRef.current === issueKey
    if (!silent) {
      setBusy(true)
      setError(null)
      setIssue(null)
      setNeedQa(null)
      setNeedQaError(null)
      setPlatforms([])
      setFixVersions([])
      setMetaError(null)
    }
    fetchIssueDetails(issueKey, roomId)
      .then((data) => {
        if (!cancelled) {
          loadedKeyRef.current = data.key
          setIssue(data)
          setNeedQa(data.needQa || null)
          setPlatforms(data.platforms || [])
          setFixVersions(data.fixVersions || [])
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load issue')
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [issueKey, roomId, refreshKey])

  async function handleNeedQa(next: (typeof NEED_QA_CHOICES)[number]) {
    if (!canEdit || !roomId || needQaBusy || needQa === next) return
    const prev = needQa
    setNeedQa(next)
    setNeedQaBusy(true)
    setNeedQaError(null)
    try {
      await setIssueNeedQa({ key: issueKey, needQa: next, roomId })
    } catch (err) {
      setNeedQa(prev)
      setNeedQaError(
        err instanceof Error ? err.message : 'Failed to set Need QA',
      )
    } finally {
      setNeedQaBusy(false)
    }
  }

  async function handlePlatforms(next: string[]) {
    if (!canEdit || !roomId || metaBusy) return
    const prev = platforms
    setPlatforms(next)
    setMetaBusy(true)
    setMetaError(null)
    try {
      const result = await setIssuePlatforms({
        key: issueKey,
        platforms: next,
        roomId,
      })
      setPlatforms(result.platforms)
    } catch (err) {
      setPlatforms(prev)
      setMetaError(
        err instanceof Error ? err.message : 'Failed to set Platform',
      )
    } finally {
      setMetaBusy(false)
    }
  }

  async function handleFixVersions(next: string[]) {
    if (!canEdit || !roomId || metaBusy) return
    const prev = fixVersions
    setFixVersions(next)
    setMetaBusy(true)
    setMetaError(null)
    try {
      const result = await setIssueFixVersions({
        key: issueKey,
        fixVersions: next,
        roomId,
      })
      setFixVersions(result.fixVersions)
    } catch (err) {
      setFixVersions(prev)
      setMetaError(
        err instanceof Error ? err.message : 'Failed to set Fix version',
      )
    } finally {
      setMetaBusy(false)
    }
  }

  if (busy) {
    return (
      <div className="ticket-viewer loading">
        <p>Loading {issueKey}…</p>
      </div>
    )
  }

  if (error || !issue) {
    return (
      <div className="ticket-viewer error">
        <h2>{issueKey}</h2>
        {fallbackSummary ? <p>{fallbackSummary}</p> : null}
        <p className="form-error">{error || 'Issue unavailable'}</p>
        {fallbackUrl ? (
          <a href={fallbackUrl} target="_blank" rel="noreferrer">
            Open in Jira
          </a>
        ) : null}
      </div>
    )
  }

  return (
    <article className="ticket-viewer">
      <header className="ticket-viewer-head">
        <div className="ticket-viewer-title">
          <div className="ticket-viewer-keyrow">
            {issue.issuetypeIcon ? (
              <img src={issue.issuetypeIcon} alt="" width={16} height={16} />
            ) : null}
            <span className="ticket-key">{issue.key}</span>
            <span className={`ticket-status cat-${issue.statusCategory || 'default'}`}>
              {issue.status}
            </span>
          </div>
          <h2>{issue.summary}</h2>
        </div>
        <a className="ghost" href={issue.url} target="_blank" rel="noreferrer">
          Open in Jira
        </a>
      </header>

      <dl className="ticket-meta">
        <div>
          <dt>Type</dt>
          <dd>{issue.issuetype || '—'}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{issue.priority || '—'}</dd>
        </div>
        <div>
          <dt>Story points</dt>
          <dd>{issue.storyPoints == null ? '—' : issue.storyPoints}</dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>
            <TicketCombobox
              label="Platform"
              values={platforms}
              options={issue.platformOptions || []}
              placeholder="iOS, Android…"
              canEdit={canEdit}
              disabled={metaBusy}
              onChange={handlePlatforms}
            />
          </dd>
        </div>
        <div>
          <dt>Fix version</dt>
          <dd>
            <TicketCombobox
              label="Fix version"
              values={fixVersions}
              options={issue.fixVersionOptions || []}
              placeholder="3.62.0…"
              canEdit={canEdit}
              disabled={metaBusy}
              onChange={handleFixVersions}
            />
            {metaError ? <p className="form-error">{metaError}</p> : null}
          </dd>
        </div>
        <div>
          <dt>Need QA</dt>
          <dd>
            <span className="ticket-need-qa">
              {NEED_QA_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className={needQa === choice ? 'active' : ''}
                  disabled={!canEdit || needQaBusy}
                  onClick={() => handleNeedQa(choice)}
                >
                  {choice}
                </button>
              ))}
            </span>
            {needQaError ? <p className="form-error">{needQaError}</p> : null}
          </dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>{issue.assignee?.displayName || 'Unassigned'}</dd>
        </div>
        {issue.parent ? (
          <div>
            <dt>Parent</dt>
            <dd>
              {issue.parent.key} · {issue.parent.summary}
            </dd>
          </div>
        ) : null}
        {issue.components.length ? (
          <div>
            <dt>Components</dt>
            <dd>{issue.components.join(', ')}</dd>
          </div>
        ) : null}
        {issue.labels.length ? (
          <div>
            <dt>Labels</dt>
            <dd className="ticket-labels">
              {issue.labels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      <section className="ticket-section">
        <h3>Description</h3>
        <div className="ticket-description">
          <AdfDocument
            doc={issue.description}
            html={issue.descriptionHtml}
            mediaIndex={issue.mediaIndex}
            mediaUrls={issue.mediaUrls}
          />
        </div>
      </section>

      {issue.comments.length > 0 ? (
        <section className="ticket-section">
          <h3>Comments ({issue.comments.length})</h3>
          <ul className="ticket-comments">
            {issue.comments.map((comment) => (
              <li key={comment.id}>
                <header>
                  <strong>{comment.author}</strong>
                  <time>
                    {comment.created
                      ? new Date(comment.created).toLocaleString()
                      : ''}
                  </time>
                </header>
                <AdfDocument
                  doc={comment.body}
                  html={comment.bodyHtml}
                  mediaIndex={issue.mediaIndex}
                  mediaUrls={issue.mediaUrls}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function TicketCombobox({
  label,
  values,
  options,
  placeholder,
  canEdit,
  disabled,
  onChange,
}: {
  label: string
  values: string[]
  options: string[]
  placeholder: string
  canEdit: boolean
  disabled: boolean
  onChange: (next: string[]) => void
}) {
  const listId = useId()
  const [draft, setDraft] = useState('')

  function addValue(raw: string) {
    const typed = raw.trim()
    if (!typed) return
    const match =
      options.find((option) => option.toLowerCase() === typed.toLowerCase()) ||
      typed
    if (values.some((value) => value.toLowerCase() === match.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...values, match])
    setDraft('')
  }

  function removeValue(name: string) {
    onChange(values.filter((value) => value !== name))
  }

  if (!canEdit) {
    return values.length ? (
      <span className="ticket-labels">
        {values.map((value) => (
          <span key={value}>{value}</span>
        ))}
      </span>
    ) : (
      <span>—</span>
    )
  }

  return (
    <div className="ticket-combobox">
      <span className="ticket-labels">
        {values.map((value) => (
          <span key={value} className="ticket-combo-chip">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              disabled={disabled}
              onClick={() => removeValue(value)}
            >
              ×
            </button>
          </span>
        ))}
      </span>
      <input
        list={listId}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value
          const exact = options.find((option) => option === next)
          if (exact) {
            addValue(exact)
            return
          }
          setDraft(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addValue(draft)
          }
        }}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  )
}
