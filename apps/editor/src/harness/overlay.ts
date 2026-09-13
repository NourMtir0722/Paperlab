import { toClient, type Landmark } from './landmarks'

/**
 * What the camera sees, drawn over the page.
 *
 * A hand driving something it cannot see itself touch needs to be SHOWN that
 * it is being read: without it, a pinch that did nothing and a pinch the
 * tracker never saw look the same, and the page reads as broken. So the hand
 * is drawn where the page thinks it is — its bones, a box round it, and a
 * label saying how sure the tracker is and what the hand is doing — and a
 * flame the camera has found gets a box and a label of its own, the way a
 * detector labels what it found.
 *
 * Plain 2D canvas over the stage, redrawn on every camera frame. Nothing here
 * decides anything: it draws what `hands-main.tsx` already decided.
 */

/** A hand, as the tracker reported it and the page read it. */
export interface HandMark {
  landmarks: readonly Landmark[]
  /** The tracker's own confidence that this is a hand, 0..1. */
  score: number
  /** What the hand is doing, as the match reads it. */
  match: 'none' | 'arming' | 'lit'
}

/** A flame the camera has found, in the frame's own coordinates. */
export interface FlameMark {
  box: { x0: number; y0: number; x1: number; y1: number }
  confidence: number
}

/** A rectangle in client pixels — the stage's canvas. */
interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * MediaPipe's 21-point hand, as bones — the same pairs
 * `HandLandmarker.HAND_CONNECTIONS` lists, written out so this file needs
 * nothing from the tracker's package and draws the same hand in a test.
 */
const BONES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
]

/** The hand's colour while it is only a hand, and once it holds a flame. */
const HAND = '#8dff6a'
const LIT = '#ffa24c'
/** A flame the camera found. */
const FIRE = '#ff7a1f'

/** What the label says the hand is doing. */
function handLabel(mark: HandMark): string {
  const sure = `${Math.round(mark.score * 100)}%`
  if (mark.match === 'lit') return `hand ${sure} · match lit`
  if (mark.match === 'arming') return `hand ${sure} · hold still…`
  return `hand ${sure}`
}

/** A filled label sitting on the top edge of a box, like a detector's. */
function chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.font = '600 13px Inter, system-ui, -apple-system, sans-serif'
  const w = ctx.measureText(text).width + 14
  const h = 22
  const top = Math.max(0, y - h)
  ctx.fillStyle = color
  ctx.fillRect(x - 1, top, w, h)
  ctx.fillStyle = '#0b0b0b'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + 6, top + h / 2 + 0.5)
}

/** A box round a set of client points, padded. */
function boxOf(points: readonly { x: number; y: number }[], pad: number) {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const p of points) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
}

/**
 * Draw one frame of what the camera sees over the stage.
 *
 * `rect` is the stage canvas in client pixels — the same rectangle the hand
 * is mapped into to aim at the sheet, so the bones land on the hand the page
 * is actually reading. The canvas is assumed to cover the viewport at
 * `devicePixelRatio`; the caller sizes it.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  hand: HandMark | null,
  flame: FlameMark | null,
): void {
  const ratio = ctx.canvas.width / Math.max(1, ctx.canvas.clientWidth || rect.width)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

  if (flame) {
    // The frame is mirrored on its way to the page, so the box's corners
    // swap sides — take the extent of both rather than trusting their order.
    const a = toClient({ x: flame.box.x0, y: flame.box.y0 }, rect)
    const b = toClient({ x: flame.box.x1, y: flame.box.y1 }, rect)
    const box = boxOf([a, b], 10)
    ctx.lineWidth = 2.5
    ctx.strokeStyle = FIRE
    ctx.shadowColor = 'rgba(255,120,30,0.7)'
    ctx.shadowBlur = 14
    ctx.strokeRect(box.x, box.y, box.w, box.h)
    ctx.shadowBlur = 0
    chip(ctx, box.x, box.y, `fire ${Math.round(flame.confidence * 100)}%`, FIRE)
  }

  if (hand && hand.landmarks.length >= 21) {
    const color = hand.match === 'lit' ? LIT : HAND
    const points = hand.landmarks.map((p) => toClient(p, rect))
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    for (const [from, to] of BONES) {
      ctx.moveTo(points[from]!.x, points[from]!.y)
      ctx.lineTo(points[to]!.x, points[to]!.y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    for (const [i, p] of points.entries()) {
      // The thumb and index tips are the two that make the match, so they
      // are the two the eye is sent to.
      const tip = i === 4 || i === 8
      ctx.beginPath()
      ctx.arc(p.x, p.y, tip ? 6 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle = tip ? color : '#ffffff'
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = color
      ctx.stroke()
    }
    const box = boxOf(points, 18)
    ctx.lineWidth = 2
    ctx.strokeStyle = color
    ctx.strokeRect(box.x, box.y, box.w, box.h)
    chip(ctx, box.x, box.y, handLabel(hand), color)
  }
}
