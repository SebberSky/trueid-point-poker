import type { ReactNode } from 'react'

type AdfMark = { type: string; attrs?: Record<string, unknown> }
type AdfNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: AdfMark[]
  content?: AdfNode[]
}

export type MediaMeta = {
  url: string
  mimeType?: string
  filename?: string
  kind?: 'image' | 'video' | 'audio' | 'file' | string
}

type AdfOptions = {
  mediaIndex?: Record<string, MediaMeta>
}

function applyMarks(text: string, marks: AdfMark[] = []): ReactNode {
  let node: ReactNode = text
  for (const mark of marks) {
    if (mark.type === 'strong') node = <strong>{node}</strong>
    else if (mark.type === 'em') node = <em>{node}</em>
    else if (mark.type === 'code') node = <code>{node}</code>
    else if (mark.type === 'strike') node = <s>{node}</s>
    else if (mark.type === 'underline') node = <u>{node}</u>
    else if (mark.type === 'link') {
      const href = String(mark.attrs?.href || '#')
      node = (
        <a href={href} target="_blank" rel="noreferrer">
          {node}
        </a>
      )
    }
  }
  return node
}

function renderNodes(
  nodes: AdfNode[] | undefined,
  keyPrefix: string,
  options: AdfOptions,
): ReactNode[] {
  if (!nodes?.length) return []
  return nodes.map((node, index) =>
    renderNode(node, `${keyPrefix}-${index}`, options),
  )
}

function resolveMedia(
  node: AdfNode,
  options: AdfOptions,
): MediaMeta | null {
  const type = String(node.attrs?.type || '')
  if (type === 'external') {
    const url = String(node.attrs?.url || '')
    if (!url) return null
    const name = String(node.attrs?.alt || url)
    return {
      url,
      filename: name,
      kind: guessKind('', name, url),
      mimeType: '',
    }
  }
  const id = String(node.attrs?.id || '')
  if (!id) return null
  if (options.mediaIndex?.[id]) return options.mediaIndex[id]
  if (/^\d+$/.test(id)) {
    return {
      url: `/api/attachments/${id}/content`,
      filename: String(node.attrs?.alt || id),
      kind: 'file',
      mimeType: '',
    }
  }
  return null
}

function guessKind(mimeType: string, filename: string, url = ''): string {
  const mime = mimeType.toLowerCase()
  const name = `${filename} ${url}`.toLowerCase()
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(name)) {
    return 'image'
  }
  if (
    mime.startsWith('video/') ||
    /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|$)/i.test(name)
  ) {
    return 'video'
  }
  if (
    mime.startsWith('audio/') ||
    /\.(mp3|wav|m4a|aac|flac)(\?|$)/i.test(name)
  ) {
    return 'audio'
  }
  if (mime.includes('pdf') || /\.pdf(\?|$)/i.test(name)) {
    return 'pdf'
  }
  return 'file'
}

function MediaPreview({ meta, alt }: { meta: MediaMeta; alt: string }) {
  const kind =
    meta.kind || guessKind(meta.mimeType || '', alt, meta.url)

  if (kind === 'image') {
    return (
      <a
        className="adf-media-link"
        href={meta.url}
        target="_blank"
        rel="noreferrer"
      >
        <img src={meta.url} alt={alt} className="adf-img" loading="lazy" />
      </a>
    )
  }

  if (kind === 'video') {
    return (
      <video className="adf-video" src={meta.url} controls preload="metadata">
        <a href={meta.url} target="_blank" rel="noreferrer">
          {alt}
        </a>
      </video>
    )
  }

  if (kind === 'audio') {
    return (
      <audio className="adf-audio" src={meta.url} controls preload="metadata">
        <a href={meta.url} target="_blank" rel="noreferrer">
          {alt}
        </a>
      </audio>
    )
  }

  if (kind === 'pdf') {
    return (
      <div className="adf-pdf-wrap">
        <iframe
          className="adf-pdf"
          src={`${meta.url}#view=FitH`}
          title={alt}
        />
        <a href={meta.url} target="_blank" rel="noreferrer" className="adf-file">
          Open {alt}
        </a>
      </div>
    )
  }

  return (
    <a className="adf-file" href={meta.url} target="_blank" rel="noreferrer">
      {alt}
    </a>
  )
}

function renderNode(
  node: AdfNode,
  key: string,
  options: AdfOptions,
): ReactNode {
  switch (node.type) {
    case 'doc':
      return (
        <div key={key} className="adf-doc">
          {renderNodes(node.content, key, options)}
        </div>
      )
    case 'paragraph':
      return (
        <p key={key} className="adf-p">
          {node.content?.length ? (
            renderNodes(node.content, key, options)
          ) : (
            <br />
          )}
        </p>
      )
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag key={key} className="adf-h">
          {renderNodes(node.content, key, options)}
        </Tag>
      )
    }
    case 'text':
      return (
        <span key={key}>{applyMarks(node.text || '', node.marks)}</span>
      )
    case 'hardBreak':
      return <br key={key} />
    case 'bulletList':
      return (
        <ul key={key} className="adf-ul">
          {renderNodes(node.content, key, options)}
        </ul>
      )
    case 'orderedList':
      return (
        <ol key={key} className="adf-ol">
          {renderNodes(node.content, key, options)}
        </ol>
      )
    case 'listItem':
      return <li key={key}>{renderNodes(node.content, key, options)}</li>
    case 'blockquote':
      return (
        <blockquote key={key} className="adf-quote">
          {renderNodes(node.content, key, options)}
        </blockquote>
      )
    case 'codeBlock':
      return (
        <pre key={key} className="adf-code">
          <code>{node.content?.map((c) => c.text || '').join('') || ''}</code>
        </pre>
      )
    case 'rule':
      return <hr key={key} className="adf-hr" />
    case 'mention':
      return (
        <span key={key} className="adf-mention">
          @{String(node.attrs?.text || node.attrs?.id || 'user')}
        </span>
      )
    case 'emoji':
      return (
        <span key={key}>
          {String(node.attrs?.text || node.attrs?.shortName || '')}
        </span>
      )
    case 'date': {
      const ts = Number(node.attrs?.timestamp)
      const label = Number.isFinite(ts)
        ? new Date(ts).toLocaleDateString()
        : 'date'
      return (
        <span key={key} className="adf-date">
          {label}
        </span>
      )
    }
    case 'mediaSingle':
    case 'mediaGroup':
      return (
        <div key={key} className={`adf-media adf-${node.type}`}>
          {renderNodes(node.content, key, options)}
        </div>
      )
    case 'media': {
      const meta = resolveMedia(node, options)
      const alt = String(node.attrs?.alt || meta?.filename || 'attachment')
      if (!meta?.url) {
        return (
          <div key={key} className="adf-media-missing">
            [media]
          </div>
        )
      }
      return <MediaPreview key={key} meta={meta} alt={alt} />
    }
    case 'table':
      return (
        <div key={key} className="adf-table-wrap">
          <table className="adf-table">
            <tbody>{renderNodes(node.content, key, options)}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr key={key}>{renderNodes(node.content, key, options)}</tr>
    case 'tableHeader':
      return <th key={key}>{renderNodes(node.content, key, options)}</th>
    case 'tableCell':
      return <td key={key}>{renderNodes(node.content, key, options)}</td>
    case 'panel':
      return (
        <div
          key={key}
          className={`adf-panel adf-panel-${node.attrs?.panelType || 'info'}`}
        >
          {renderNodes(node.content, key, options)}
        </div>
      )
    case 'status':
      return (
        <span key={key} className="adf-status">
          {String(node.attrs?.text || 'status')}
        </span>
      )
    case 'inlineCard':
    case 'blockCard':
      return (
        <a
          key={key}
          className="adf-card"
          href={String(node.attrs?.url || '#')}
          target="_blank"
          rel="noreferrer"
        >
          {String(node.attrs?.url || 'link')}
        </a>
      )
    default:
      if (node.content?.length) {
        return (
          <div key={key} className="adf-unknown">
            {renderNodes(node.content, key, options)}
          </div>
        )
      }
      if (node.text) return <span key={key}>{node.text}</span>
      return null
  }
}

export function AdfDocument({
  doc,
  mediaIndex,
  mediaUrls,
  html,
}: {
  doc: unknown
  mediaIndex?: Record<string, MediaMeta>
  mediaUrls?: Record<string, string>
  html?: string | null
}) {
  const index =
    mediaIndex ||
    (mediaUrls
      ? Object.fromEntries(
          Object.entries(mediaUrls).map(([id, url]) => [
            id,
            { url, kind: 'file' as const },
          ]),
        )
      : undefined)

  if (doc && typeof doc === 'object') {
    return <>{renderNode(doc as AdfNode, 'root', { mediaIndex: index })}</>
  }
  if (html?.trim()) {
    return (
      <div
        className="adf-html"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
  return <p className="adf-empty">No description</p>
}
