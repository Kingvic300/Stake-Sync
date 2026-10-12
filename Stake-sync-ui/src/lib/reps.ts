import type { Exercise } from '../data/types'

/** MediaPipe pose landmark indices we use. */
const L = { shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28 }

export interface Point {
  x: number
  y: number
  visibility?: number
}

const seen = (p?: Point) => !!p && (p.visibility ?? 1) > 0.5

/** Angle ABC in degrees. */
export function angle(a: Point, b: Point, c: Point) {
  const ab = Math.atan2(a.y - b.y, a.x - b.x)
  const cb = Math.atan2(c.y - b.y, c.x - b.x)
  let deg = Math.abs(((ab - cb) * 180) / Math.PI)
  if (deg > 180) deg = 360 - deg
  return deg
}

/** Uses whichever side of the body the camera sees better. */
function sideAngle(lm: Point[], left: [number, number, number], right: [number, number, number]) {
  const vis = (ids: number[]) => ids.reduce((s, i) => s + (lm[i]?.visibility ?? 0), 0)
  const side = vis(left) >= vis(right) ? left : right
  const [a, b, c] = side.map((i) => lm[i])
  if (!seen(a) || !seen(b) || !seen(c)) return null
  return angle(a, b, c)
}

/** Torso tilt from horizontal, in degrees (0 = lying flat, 90 = standing). */
function torsoTilt(lm: Point[]) {
  const s = seen(lm[L.shoulderL]) ? lm[L.shoulderL] : lm[L.shoulderR]
  const h = seen(lm[L.hipL]) ? lm[L.hipL] : lm[L.hipR]
  if (!seen(s) || !seen(h)) return null
  return Math.abs((Math.atan2(Math.abs(s.y - h.y), Math.abs(s.x - h.x)) * 180) / Math.PI)
}

export type Phase = 'up' | 'down' | 'unknown'

export interface CounterState {
  phase: Phase
  reps: number
  lastRepAt: number
  /** Short instruction for the person, or null when tracking is good */
  hint: string | null
  /** The angle being tracked, for the on-screen meter */
  value: number | null
}

export const initialCounter: CounterState = { phase: 'unknown', reps: 0, lastRepAt: 0, hint: 'Step back so your whole body is in view', value: null }

const rules: Record<Exercise, { joint: 'elbow' | 'hip' | 'knee'; down: number; up: number; countOn: 'up' | 'down'; hint: string }> = {
  // Elbows bend below ~95° at the bottom and straighten past ~155° at the top.
  pushups: { joint: 'elbow', down: 95, up: 155, countOn: 'up', hint: 'Turn sideways to the camera, body in a straight line' },
  // Hips close below ~70° when sitting up and open past ~120° lying back.
  situps: { joint: 'hip', down: 120, up: 70, countOn: 'down', hint: 'Lie sideways to the camera with knees bent' },
  // Knees bend below ~100° at the bottom of the squat.
  squats: { joint: 'knee', down: 100, up: 160, countOn: 'up', hint: 'Stand sideways to the camera, feet in view' },
}

/**
 * Advances the rep counter by one pose frame. Pure, so it can be unit tested
 * and run on the server against sampled landmarks to audit a submitted set.
 */
export function step(state: CounterState, lm: Point[] | undefined, exercise: Exercise, now: number): CounterState {
  const r = rules[exercise]
  if (!lm?.length) return { ...state, hint: 'Step back so your whole body is in view', value: null }

  const value =
    r.joint === 'elbow'
      ? sideAngle(lm, [L.shoulderL, L.elbowL, L.wristL], [L.shoulderR, L.elbowR, L.wristR])
      : r.joint === 'hip'
        ? sideAngle(lm, [L.shoulderL, L.hipL, L.kneeL], [L.shoulderR, L.hipR, L.kneeR])
        : sideAngle(lm, [L.hipL, L.kneeL, L.ankleL], [L.hipR, L.kneeR, L.ankleR])
  if (value === null) return { ...state, hint: r.hint, value: null }

  // Push-ups only count with the body near horizontal, which filters out standing arm pumps.
  if (exercise === 'pushups') {
    const tilt = torsoTilt(lm)
    if (tilt !== null && tilt > 45) return { ...state, hint: 'Get into a push-up position', value }
  }

  const isDown = exercise === 'situps' ? value > r.down : value < r.down
  const isUp = exercise === 'situps' ? value < r.up : value > r.up
  let { phase, reps, lastRepAt } = state

  if (isDown && phase !== 'down') {
    if (r.countOn === 'down' && phase === 'up' && now - lastRepAt > 450) {
      reps += 1
      lastRepAt = now
    }
    phase = 'down'
  } else if (isUp && phase !== 'up') {
    if (r.countOn === 'up' && phase === 'down' && now - lastRepAt > 450) {
      reps += 1
      lastRepAt = now
    }
    phase = 'up'
  }
  return { phase, reps, lastRepAt, hint: null, value }
}

export const exerciseNames: Record<Exercise, { one: string; many: string }> = {
  pushups: { one: 'push-up', many: 'push-ups' },
  situps: { one: 'sit-up', many: 'sit-ups' },
  squats: { one: 'squat', many: 'squats' },
}
