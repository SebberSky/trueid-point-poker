import { useEffect, useState } from 'react'
import { AdfDocument } from './AdfDocument'
import { appUrl } from './appUrl'

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
  reporter: { displayName: string; avatarUrl?: string | null } | null
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
  fallbackSummary?: string
  fallbackUrl?: string
}

export function TicketViewer({
  issueKey,
  roomId,
  fallbackSummary = '',
  fallbackUrl = '',
}: TicketViewerProps) {
  const [issue, setIssue] = useState<IssueDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(null)
    setIssue(null)
    fetchIssueDetails(issueKey, roomId)
      .then((data) => {
        if (!cancelled) setIssue(data)
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
  }, [issueKey, roomId])

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
          <dt>Assignee</dt>
          <dd>{issue.assignee?.displayName || 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Reporter</dt>
          <dd>{issue.reporter?.displayName || '—'}</dd>
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
