import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { appUrl } from './appUrl'

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

type LightboxItem = {
  url: string
  alt: string
  kind: string
}

type AdfOptions = {
  mediaIndex?: Record<string, MediaMeta>
  onOpenMedia?: (item: LightboxItem) => void
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
    } else if (mark.type === 'textColor') {
      const color = String(mark.attrs?.color || '')
      if (color) node = <span style={{ color }}>{node}</span>
    } else if (mark.type === 'backgroundColor') {
      const color = String(mark.attrs?.color || '')
      if (color) node = <span style={{ backgroundColor: color }}>{node}</span>
    } else if (mark.type === 'subsup') {
      node =
        mark.attrs?.type === 'sub' ? <sub>{node}</sub> : <sup>{node}</sup>
    }
  }
  return node
}

function cellLayout(node: AdfNode): {
  colSpan?: number
  rowSpan?: number
  style?: CSSProperties
} {
  const attrs = node.attrs || {}
  const colspan = Number(attrs.colspan)
  const rowspan = Number(attrs.rowspan)
  const widths = Array.isArray(attrs.colwidth)
    ? (attrs.colwidth as unknown[]).map((n) => Number(n)).filter((n) => n > 0)
    : []
  const width = widths.reduce((sum, n) => sum + n, 0)
  const background =
    typeof attrs.background === 'string' && attrs.background
      ? attrs.background
      : ''
  const style: CSSProperties = {}
  if (width) {
    style.width = `${width}px`
    style.minWidth = `${width}px`
  }
  if (background) style.backgroundColor = background
  return {
    colSpan: colspan > 1 ? colspan : undefined,
    rowSpan: rowspan > 1 ? rowspan : undefined,
    style: Object.keys(style).length ? style : undefined,
  }
}

function headerRowCount(rows: AdfNode[]): number {
  let count = 0
  for (const row of rows) {
    const cells = row.content || []
    if (
      row.type !== 'tableRow' ||
      !cells.length ||
      cells.some((cell) => cell.type !== 'tableHeader')
    ) {
      break
    }
    count += 1
  }
  return count
}

function renderTable(node: AdfNode, key: string, options: AdfOptions): ReactNode {
  const rows = node.content || []
  const numbered = Boolean(node.attrs?.isNumberColumnEnabled)
  const headCount = headerRowCount(rows)
  const width = Number(node.attrs?.width)
  const layout = String(node.attrs?.layout || 'default')
  const wrapClass = [
    'adf-table-wrap',
    numbered ? 'is-numbered' : '',
    layout === 'wide' || layout === 'full-width' ? `layout-${layout}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const tableStyle: CSSProperties | undefined =
    Number.isFinite(width) && width > 0 ? { width: `${width}px` } : undefined

  function renderRow(row: AdfNode, rowKey: string, index: number, inHead: boolean) {
    return (
      <tr key={rowKey}>
        {numbered ? (
          inHead ? (
            <th className="adf-table-num" />
          ) : (
            <td className="adf-table-num">{index + 1}</td>
          )
        ) : null}
        {renderNodes(row.content, rowKey, options)}
      </tr>
    )
  }

  return (
    <div key={key} className={wrapClass}>
      <table className="adf-table" style={tableStyle}>
        {headCount ? (
          <thead>
            {rows.slice(0, headCount).map((row, index) =>
              renderRow(row, `${key}-h-${index}`, index, true),
            )}
          </thead>
        ) : null}
        <tbody>
          {rows.slice(headCount).map((row, index) =>
            renderRow(row, `${key}-b-${index}`, index, false),
          )}
        </tbody>
      </table>
    </div>
  )
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
      url: appUrl(`/api/attachments/${id}/content`),
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

function MediaPreview({
  meta,
  alt,
  onOpen,
}: {
  meta: MediaMeta
  alt: string
  onOpen?: (item: LightboxItem) => void
}) {
  const kind =
    meta.kind || guessKind(meta.mimeType || '', alt, meta.url)

  function openPreview(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!onOpen) return
    onOpen({ url: meta.url, alt, kind })
  }

  if (kind === 'image') {
    return (
      <button type="button" className="adf-media-link" onClick={openPreview}>
        <img src={meta.url} alt={alt} className="adf-img" loading="lazy" />
      </button>
    )
  }

  if (kind === 'video') {
    return (
      <button type="button" className="adf-media-link" onClick={openPreview}>
        <video className="adf-video" src={meta.url} preload="metadata" muted />
      </button>
    )
  }

  if (kind === 'audio') {
    return (
      <button type="button" className="adf-media-link" onClick={openPreview}>
        <span className="adf-file">{alt}</span>
      </button>
    )
  }

  if (kind === 'pdf') {
    return (
      <button type="button" className="adf-media-link" onClick={openPreview}>
        <span className="adf-file">Preview {alt}</span>
      </button>
    )
  }

  return (
    <a className="adf-file" href={meta.url} rel="noreferrer">
      {alt}
    </a>
  )
}

function MediaLightbox({
  item,
  onClose,
}: {
  item: LightboxItem | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!item) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [item, onClose])

  if (!item) return null

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      onClick={onClose}
    >
      <button
        type="button"
        className="media-lightbox-close"
        onClick={onClose}
      >
        Close
      </button>
      <div
        className="media-lightbox-body"
        onClick={(event) => event.stopPropagation()}
      >
        {item.kind === 'image' ? (
          <img src={item.url} alt={item.alt} />
        ) : null}
        {item.kind === 'video' ? (
          <video src={item.url} controls autoPlay />
        ) : null}
        {item.kind === 'audio' ? (
          <audio src={item.url} controls autoPlay />
        ) : null}
        {item.kind === 'pdf' ? (
          <iframe src={`${item.url}#view=FitH`} title={item.alt} />
        ) : null}
      </div>
    </div>
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
    case 'paragraph': {
      const alignment = String(node.attrs?.alignment || '')
      const style: CSSProperties | undefined =
        alignment === 'center' || alignment === 'right' || alignment === 'left'
          ? { textAlign: alignment }
          : undefined
      return (
        <p key={key} className="adf-p" style={style}>
          {node.content?.length ? (
            renderNodes(node.content, key, options)
          ) : (
            <br />
          )}
        </p>
      )
    }
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
      return <MediaPreview key={key} meta={meta} alt={alt} onOpen={options.onOpenMedia} />
    }
    case 'table':
      return renderTable(node, key, options)
    case 'tableRow':
      return <tr key={key}>{renderNodes(node.content, key, options)}</tr>
    case 'tableHeader': {
      const layout = cellLayout(node)
      return (
        <th
          key={key}
          colSpan={layout.colSpan}
          rowSpan={layout.rowSpan}
          style={layout.style}
        >
          {renderNodes(node.content, key, options)}
        </th>
      )
    }
    case 'tableCell': {
      const layout = cellLayout(node)
      return (
        <td
          key={key}
          colSpan={layout.colSpan}
          rowSpan={layout.rowSpan}
          style={layout.style}
        >
          {renderNodes(node.content, key, options)}
        </td>
      )
    }
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
  const [preview, setPreview] = useState<LightboxItem | null>(null)
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

  function openFromHtml(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null
    if (!target) return
    const img = target.closest('img')
    if (img?.src) {
      event.preventDefault()
      event.stopPropagation()
      setPreview({
        url: img.currentSrc || img.src,
        alt: img.alt || 'image',
        kind: 'image',
      })
      return
    }
    const media = target.closest('video, audio, a') as
      | HTMLVideoElement
      | HTMLAudioElement
      | HTMLAnchorElement
      | null
    if (!media) return
    const url =
      'href' in media && media.href
        ? media.href
        : 'currentSrc' in media
          ? media.currentSrc || media.src
          : ''
    if (!url) return
    const kind = guessKind('', media.textContent || url, url)
    if (kind === 'file') return
    event.preventDefault()
    event.stopPropagation()
    setPreview({
      url,
      alt: media.textContent || url,
      kind,
    })
  }

  const body =
    doc && typeof doc === 'object' ? (
      renderNode(doc as AdfNode, 'root', {
        mediaIndex: index,
        onOpenMedia: setPreview,
      })
    ) : html?.trim() ? (
      <div
        className="adf-html"
        dangerouslySetInnerHTML={{ __html: html }}
        onClickCapture={openFromHtml}
      />
    ) : (
      <p className="adf-empty">No description</p>
    )

  return (
    <>
      {body}
      <MediaLightbox item={preview} onClose={() => setPreview(null)} />
    </>
  )
}
