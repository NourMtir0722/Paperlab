/**
 * Stop-motion feel: quantize continuous time to animation "twos"
 * (12 steps per second, like shooting on twos at 24fps). Applies to
 * deformer time, idle motion, and behavior progress; the camera is
 * excluded by default — quantized cameras read as jank, not craft.
 */
export const ON_TWOS_FPS = 12

export function quantizeTime(t: number, fps: number = ON_TWOS_FPS): number {
  return Math.floor(t * fps) / fps
}

/** Snap a 0..1 progress that plays over `duration` seconds to whole frames. */
export function quantizeProgress(p: number, duration: number, fps: number = ON_TWOS_FPS): number {
  const steps = Math.max(1, Math.round(duration * fps))
  return Math.round(p * steps) / steps
}
