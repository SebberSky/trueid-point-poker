import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { emitDrawRemove, emitDrawStroke } from './socket'
import {
  DEFAULT_DRAW_COLOR,
  DRAW_COLORS,
  type DrawPoint,
  type DrawStroke,
} from './types'

const DRAG_THRESHOLD_PX = 6
const MAX_POINTS = 500

function isInteractive(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      'a, button, input, textarea, select, label, [role="button"]',
    ),
  )
}

function isTicketContentReady(wrap: HTMLElement | null) {
  if (!wrap) return false
  const viewer = wrap.querySelector(':scope > .ticket-viewer')
  if (!viewer) return false
  return (
    !viewer.classList.contains('loading') &&
    !viewer.classList.contains('error')
  )
}

function pointInWrap(
  event: { clientX: number; clientY: number },
  wrap: HTMLElement,
): DrawPoint {
  const rect = wrap.getBoundingClientRect()
  const width = rect.width || 1
  const height = rect.height || 1
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / height)),
  }
}

function newStrokeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeTicketKey(key: string | undefined) {
  return String(key || '')
    .trim()
    .toUpperCase()
}

function strokesForTicket(list: DrawStroke[] | undefined, ticketKey: string) {
  const key = normalizeTicketKey(ticketKey)
  if (!key) return []
  return (list || []).filter(
    (stroke) => normalizeTicketKey(stroke.ticketKey) === key,
  )
}

type TicketDrawLayerProps = {
  ticketKey: string
  canDraw: boolean
  strokes?: DrawStroke[]
  children: ReactNode
}

export function TicketDrawLayer({
  ticketKey,
  canDraw,
  strokes,
  children,
}: TicketDrawLayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const draftIdRef = useRef<string | null>(null)
  const pendingRef = useRef<{
    clientX: number
    clientY: number
    point: DrawPoint
  } | null>(null)
  const pointsRef = useRef<DrawPoint[]>([])
  const colorRef = useRef(DEFAULT_DRAW_COLOR)

  const [color, setColor] = useState<string>(DEFAULT_DRAW_COLOR)
  const [drawing, setDrawing] = useState(false)
  const [lines, setLines] = useState<DrawStroke[]>(() =>
    strokesForTicket(strokes, ticketKey),
  )

  colorRef.current = color

  useEffect(() => {
    const incoming = strokesForTicket(strokes, ticketKey)
    const draftId = draftIdRef.current
    setLines((current) => {
      if (draftId && !incoming.some((stroke) => stroke.id === draftId)) {
        const draft = current.find((stroke) => stroke.id === draftId)
        return draft ? [...incoming, draft] : incoming
      }
      if (draftId && incoming.some((stroke) => stroke.id === draftId)) {
        draftIdRef.current = null
      }
      return incoming
    })
  }, [strokes, ticketKey])

  function upsertLocal(stroke: DrawStroke) {
    setLines((current) => {
      const idx = current.findIndex((item) => item.id === stroke.id)
      if (idx < 0) return [...current, stroke]
      const next = [...current]
      next[idx] = stroke
      return next
    })
  }

  function makeStroke(points: DrawPoint[]): DrawStroke | null {
    const id = draftIdRef.current
    if (!id || points.length < 2) return null
    return {
      id,
      ticketKey: normalizeTicketKey(ticketKey),
      color: colorRef.current,
      points,
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canDraw || event.button !== 0) return
    if (isInteractive(event.target)) return
    const wrap = wrapRef.current
    if (!wrap || !isTicketContentReady(wrap)) return
    pendingRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      point: pointInWrap(event, wrap),
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canDraw) return
    const wrap = wrapRef.current
    if (!wrap || !isTicketContentReady(wrap)) return
    const pending = pendingRef.current

    if (!drawingRef.current) {
      if (!pending) return
      const dx = event.clientX - pending.clientX
      const dy = event.clientY - pending.clientY
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      drawingRef.current = true
      draftIdRef.current = newStrokeId()
      setDrawing(true)
      wrap.setPointerCapture(event.pointerId)
      const next = [pending.point, pointInWrap(event, wrap)]
      pointsRef.current = next
      pendingRef.current = null
      const stroke = makeStroke(next)
      if (stroke) upsertLocal(stroke)
      return
    }

    event.preventDefault()
    const point = pointInWrap(event, wrap)
    const prev = pointsRef.current[pointsRef.current.length - 1]
    if (
      prev &&
      Math.abs(prev.x - point.x) < 0.001 &&
      Math.abs(prev.y - point.y) < 0.001
    ) {
      return
    }
    const next = [...pointsRef.current, point].slice(0, MAX_POINTS)
    pointsRef.current = next
    const stroke = makeStroke(next)
    if (stroke) upsertLocal(stroke)
  }

  function finishStroke(event: ReactPointerEvent<HTMLDivElement>) {
    pendingRef.current = null
    if (!drawingRef.current) return
    drawingRef.current = false
    setDrawing(false)
    const wrap = wrapRef.current
    if (wrap?.hasPointerCapture(event.pointerId)) {
      wrap.releasePointerCapture(event.pointerId)
    }
    const stroke = makeStroke(pointsRef.current)
    pointsRef.current = []
    if (!stroke) {
      draftIdRef.current = null
      return
    }
    upsertLocal(stroke)
    emitDrawStroke(stroke)
  }

  function onContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!canDraw) return
    const target = event.target
    if (!(target instanceof Element)) return
    const id = target.getAttribute('data-stroke-id')
    if (!id) return
    event.preventDefault()
    if (draftIdRef.current === id) draftIdRef.current = null
    setLines((current) => current.filter((item) => item.id !== id))
    emitDrawRemove(id)
  }

  return (
    <>
      {canDraw ? (
        <div className="ticket-draw-colors" role="group" aria-label="Draw color">
          <span>Drag to draw · Right-click a line to erase</span>
          {DRAW_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              className={color === value ? 'active' : ''}
              style={{ background: value }}
              aria-label={`Draw ${value}`}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
            />
          ))}
        </div>
      ) : null}
      <div
        ref={wrapRef}
        className={`ticket-draw-wrap${canDraw ? ' can-draw' : ''}${drawing ? ' is-drawing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onContextMenu={onContextMenu}
      >
        {children}
        <svg
          className="ticket-draw-layer"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {lines.map((stroke) => {
            if (stroke.points.length < 2) return null
            const line = stroke.points
              .map((point) => `${point.x},${point.y}`)
              .join(' ')
            return (
              <g key={stroke.id}>
                <polyline
                  points={line}
                  fill="none"
                  stroke="#fff"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={line}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {canDraw && !drawing ? (
                  <polyline
                    className="draw-hit"
                    data-stroke-id={stroke.id}
                    points={line}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="14"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
    </>
  )
}
