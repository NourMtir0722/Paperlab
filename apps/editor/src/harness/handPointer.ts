/**
 * A hand, read from a camera, driving the pointer the paper already listens to.
 *
 * The library has no idea this exists, and that is the point. `PaperMesh`
 * already binds cloth grabbing to `onPointerDown/Move/Up`, so the shortest
 * honest path from a webcam to a sheet of paper is not a new API — it is a
 * synthetic `PointerEvent` dispatched at the canvas. R3F raycasts it exactly
 * as it raycasts a mouse, which means this adapter gets cloth grabs, strip
 * pulls, hover states and behavior handles for free, and cannot drift from
 * what a mouse does because it IS what a mouse does.
 *
 * Whether the hand is holding is decided in `gestures.ts` and passed in. This
 * used to work it out from the aperture itself, which meant two state
 * machines could disagree about whether a pinch was closed — the gesture
 * layer saying `fist` while the pointer stayed down.
 *
 * The one wrinkle is pointer capture, and it is worth writing down because it
 * looks like a hack and is not. `PaperMesh` calls
 * `e.target.setPointerCapture(e.pointerId)` when a grab lands, so that
 * dragging OFF the sheet keeps feeding the sim. R3F's `event.target` is not
 * the DOM element — it is R3F's own shim, which first records the capture in
 * its internal `capturedMap` (this is the part that actually routes off-mesh
 * moves) and only then forwards to the real element to keep the browser in
 * sync. A synthetic pointer id belongs to no live browser pointer, so that
 * forward throws `NotFoundError`. Neutralising it for our id alone costs
 * nothing — R3F's routing is already established by the time the call
 * happens — and leaves capture working for every real pointer on the page.
 */

/**
 * How much of the camera frame maps to the full canvas. Hands do not
 * comfortably reach the edges of their own camera image — the corners are
 * where tracking degrades and where your elbow runs out — so the middle 70%
 * is stretched to cover everything and the rest is clamped away.
 */
const REACH_MARGIN = 0.15

/** Map a normalised camera coordinate into the reachable sub-frame. */
export function reach(value: number): number {
  const span = 1 - REACH_MARGIN * 2
  return Math.min(1, Math.max(0, (value - REACH_MARGIN) / span))
}

/**
 * Where a point in the camera's frame lands on the canvas.
 *
 * Mirrored: the camera sees you face-on, so without the flip the cursor runs
 * the opposite way to your hand and no one can aim it.
 *
 * Separate from the pointer because a SECOND hand needs the same mapping
 * without dispatching anything — it has to know where it is over the sheet to
 * score or to tear, and only one hand at a time can own the pointer.
 */
export function toClient(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: rect.left + reach(1 - point.x) * rect.width,
    y: rect.top + reach(point.y) * rect.height,
  }
}

export interface PointerState {
  /** Client-space position of the synthetic pointer. */
  x: number
  y: number
  down: boolean
  /** False when there was no hand to place the pointer from. */
  tracked: boolean
}

/**
 * Turns a stream of hands into a stream of pointer events on one element.
 *
 * Stateful on purpose: a pointer is a thing that is down or up, and the
 * transitions are the whole product. `update` is safe to call every frame
 * with or without a hand.
 */
export class HandPointer {
  private down = false
  private last: PointerState = { x: 0, y: 0, down: false, tracked: false }
  private readonly realSetCapture: (id: number) => void
  private readonly realReleaseCapture: (id: number) => void

  constructor(
    private readonly el: HTMLElement,
    /** Kept clear of the small integers browsers hand out to real pointers. */
    private readonly pointerId = 9001,
  ) {
    this.realSetCapture = el.setPointerCapture.bind(el)
    this.realReleaseCapture = el.releasePointerCapture.bind(el)
    // See the note at the top of this file: ours is a pointer the browser has
    // never heard of, so only ours is skipped.
    el.setPointerCapture = (id: number) => {
      if (id !== this.pointerId) this.realSetCapture(id)
    }
    el.releasePointerCapture = (id: number) => {
      if (id !== this.pointerId) this.realReleaseCapture(id)
    }
  }

  /**
   * Feed one frame, with the point the gesture is aimed from in normalised
   * camera coordinates. Pass `null` when there is nothing to aim — a hand
   * that leaves the frame mid-grab must let go, or the sheet stays stuck to
   * a particle nobody is holding.
   *
   * The anchor is the caller's choice rather than this class's, because it
   * depends on the gesture: a pinch holds at the midpoint of thumb and
   * finger, and a pointing hand is aimed from the fingertip.
   */
  update(point: { x: number; y: number } | null, closed: boolean): PointerState {
    if (!point) {
      if (this.down) this.release(this.last.x, this.last.y)
      this.last = { ...this.last, down: false, tracked: false }
      return this.last
    }

    const { x, y } = toClient(point, this.el.getBoundingClientRect())

    // Move first, always. R3F resolves hover from the move, and a `pointerdown`
    // that arrives without one still raycasts correctly but leaves the sheet
    // having never been entered — which the interaction-state machine reads as
    // a press with no hover before it.
    this.dispatch('pointermove', x, y, this.down ? 1 : 0)
    if (closed && !this.down) {
      this.down = true
      this.dispatch('pointerdown', x, y, 1)
    } else if (!closed && this.down) {
      this.release(x, y)
    }

    this.last = { x, y, down: this.down, tracked: true }
    return this.last
  }

  private release(x: number, y: number): void {
    this.down = false
    this.dispatch('pointerup', x, y, 0)
  }

  private dispatch(type: string, clientX: number, clientY: number, buttons: number): void {
    this.el.dispatchEvent(
      new PointerEvent(type, {
        pointerId: this.pointerId,
        // 'mouse' rather than 'touch': the paper's drag path is written for a
        // single hovering pointer, which is what this is.
        pointerType: 'mouse',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        button: type === 'pointermove' ? -1 : 0,
        buttons,
      }),
    )
  }

  /** Let go of anything held, and give the element its own methods back. */
  dispose(): void {
    if (this.down) this.release(this.last.x, this.last.y)
    this.el.setPointerCapture = this.realSetCapture
    this.el.releasePointerCapture = this.realReleaseCapture
  }
}
