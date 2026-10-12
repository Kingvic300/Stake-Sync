import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { ArrowLeft, Camera, Check, EyeOff, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Bone } from '../../components/Skeleton'
import { Button } from '../../components/ui'
import type { Challenge } from '../../data/types'
import { api, ApiError } from '../../lib/api'
import { useApiData } from '../../lib/useApiData'
import { AppPageSkeleton } from '../../components/Skeleton'
import type { Exercise } from '../../data/types'
import { cx } from '../../lib/format'
import { gsap, prefersMotion } from '../../lib/gsap'
import { exerciseNames, initialCounter, step, type CounterState } from '../../lib/reps'
import { reportError } from '../../lib/report'
import { useToast } from '../../toast/context'

// Wasm comes from the CDN matching the installed package; the model can be self-hosted later.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm'
const MODEL =
  import.meta.env.VITE_POSE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

type Stage = 'intro' | 'loading' | 'live' | 'done' | 'denied' | 'failed'

const TARGET = 100

// Frame clock for the pose model; only ever called from the camera loop and handlers.
const clock = () => performance.now()

export function Workout() {
  const { id = '' } = useParams()
  const src = useApiData<Challenge>(`/challenges/${encodeURIComponent(id)}`)
  if (!src.data && !src.error) return <AppPageSkeleton />
  return <WorkoutBody c={src.data} />
}

function WorkoutBody({ c }: { c: Challenge | null }) {
  const navigate = useNavigate()
  const [exercise, setExercise] = useState<Exercise>(c?.exercise ?? 'pushups')
  const [stage, setStage] = useState<Stage>('intro')
  const [counter, setCounter] = useState<CounterState>(initialCounter)
  const [doneToday, setDoneToday] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [snaps, setSnaps] = useState<string[]>([])
  const toast = useToast()

  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const countEl = useRef<HTMLDivElement>(null)
  const landmarker = useRef<PoseLandmarker | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const raf = useRef(0)
  const state = useRef<CounterState>(initialCounter)
  // Joint angles sampled about 10 times a second; the server checks they look like real reps.
  const angles = useRef<number[]>([])
  const lastSample = useRef(0)
  const startedIso = useRef('')

  function stop() {
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  useEffect(() => () => {
    stop()
    landmarker.current?.close()
  }, [])

  useEffect(() => {
    if (stage !== 'live') return
    const id = window.setInterval(() => setElapsed(Math.round((clock() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [stage, startedAt])

  function snapshot() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const cv = document.createElement('canvas')
    cv.width = 240
    cv.height = Math.round((240 * v.videoHeight) / v.videoWidth)
    cv.getContext('2d')?.drawImage(v, 0, 0, cv.width, cv.height)
    setSnaps((s) => (s.length >= 3 ? s : [...s, cv.toDataURL('image/jpeg', 0.6)]))
  }

  async function start() {
    setStage('loading')
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } }, audio: false })
    } catch (e) {
      reportError(e, { where: 'camera' })
      setStage('denied')
      return
    }
    try {
      if (!landmarker.current) {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
        const files = await FilesetResolver.forVisionTasks(WASM)
        landmarker.current = await PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
      }
      const v = video.current!
      v.srcObject = stream.current
      await v.play()
      state.current = initialCounter
      setCounter(initialCounter)
      setSnaps([])
      angles.current = []
      startedIso.current = new Date().toISOString()
      setStartedAt(clock())
      setElapsed(0)
      setStage('live')
      loop()
    } catch (e) {
      reportError(e, { where: 'pose-model' })
      stop()
      setStage('failed')
    }
  }

  function loop() {
    const v = video.current
    const cv = canvas.current
    const lm = landmarker.current
    if (!v || !cv || !lm || v.readyState < 2) {
      raf.current = requestAnimationFrame(loop)
      return
    }
    const now = clock()
    const result = lm.detectForVideo(v, now)
    const pose = result.landmarks[0]
    const next = step(state.current, pose, exercise, now)
    if (next.reps !== state.current.reps) {
      if (next.reps === 1 || next.reps % 10 === 0) snapshot()
      if (prefersMotion() && countEl.current) gsap.fromTo(countEl.current, { scale: 1.25 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' })
    }
    if (next.value !== null && now - lastSample.current >= 100) {
      lastSample.current = now
      angles.current.push(Math.round(next.value * 10) / 10)
    }
    state.current = next
    setCounter(next)
    draw(cv, v, pose)
    raf.current = requestAnimationFrame(loop)
  }

  function finish() {
    stop()
    const reps = state.current.reps
    setStage('done')
    if (reps <= 0 || !c) return
    snapshot()
    setDoneToday((d) => d + reps)
    const names = exerciseNames[exercise]
    const durationSec = Math.min(7200, Math.max(1, Math.round((clock() - startedAt) / 1000)))
    api('/verification/proofs/camera', { method: 'POST', body: { challengeId: c.id, reps, durationSec, angles: angles.current, startedAt: startedIso.current } })
      .then(() => toast({ title: `${reps} ${reps === 1 ? names.one : names.many} counted`, body: 'Sent for today’s check.' }))
      .catch((err) => {
        setDoneToday((d) => d - reps)
        toast({ tone: 'error', title: 'Set not saved', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
      })
  }

  if (!c) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-3xl font-bold">This workout link isn’t valid</h1>
        <Button to="/dashboard" className="mt-6">
          Back to my challenges
        </Button>
      </div>
    )
  }

  const names = exerciseNames[exercise]
  const today = doneToday + (stage === 'live' ? counter.reps : 0)
  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="mx-auto max-w-[120rem] px-4 py-6 sm:px-6 sm:py-10 lg:px-12 2xl:px-16">
      <Link to={`/c/${c.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate hover:text-ink">
        <ArrowLeft size={17} /> {c.title}
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-ink">
          <video ref={video} playsInline muted className={cx('absolute inset-0 size-full -scale-x-100 object-cover', stage !== 'live' && 'invisible')} />
          <canvas ref={canvas} className={cx('absolute inset-0 size-full -scale-x-100 object-cover', stage !== 'live' && 'invisible')} />

          {stage === 'intro' && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center text-white">
              <div>
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10">
                  <Camera size={28} />
                </span>
                <p className="mt-5 text-lg font-semibold">Your camera counts each {names.one}</p>
                <p className="mt-1 text-white/60">Prop your phone up about 2 metres away, side-on to you.</p>
              </div>
            </div>
          )}
          {stage === 'loading' && (
            <div role="status" aria-busy="true" className="absolute inset-0 flex flex-col justify-end gap-3 p-6">
              <span className="sr-only">Starting the camera</span>
              <Bone dark className="h-full w-full rounded-2xl" />
              <Bone dark className="h-4 w-1/3" />
            </div>
          )}
          {stage === 'denied' && (
            <Notice
              title="Camera access is off"
              body="Allow camera access for Stake-Sync in your browser’s site settings, then try again. Video never leaves your phone."
              onRetry={start}
            />
          )}
          {stage === 'failed' && (
            <Notice title="The counter didn’t start" body="Check your connection and try again. Nothing was counted, so you haven’t lost anything." onRetry={start} />
          )}

          {stage === 'live' && (
            <>
              <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full bg-ink/70 px-3 py-1.5 text-sm text-white backdrop-blur">
                <span className={cx('size-2 rounded-full', counter.hint ? 'bg-gold' : 'bg-calm')} />
                {counter.hint ?? 'Tracking'}
              </div>
              <div className="absolute top-4 right-4 rounded-full bg-ink/70 px-3 py-1.5 text-sm text-white tabular backdrop-blur">{mm}</div>
              <div className="absolute bottom-4 left-4 rounded-2xl bg-ink/75 px-5 py-3 text-white backdrop-blur">
                <div ref={countEl} className="origin-left font-display text-6xl font-bold tabular">
                  {counter.reps}
                </div>
                <div className="text-sm text-white/70">{names.many} this set</div>
              </div>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-5">
          <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
            <div className="flex items-baseline justify-between">
              <h1 className="text-2xl font-bold">Today</h1>
              <span className="font-display text-2xl font-bold tabular">
                {Math.min(today, TARGET)}
                <span className="text-slate/60"> / {TARGET}</span>
              </span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-tile">
              <span className="block h-full rounded-full bg-cobalt transition-[width] duration-300" style={{ width: `${Math.min(100, (today / TARGET) * 100)}%` }} />
            </div>
            <p className="mt-3 text-[15px] text-slate">
              {today >= TARGET ? 'Today’s requirement is done.' : `${TARGET - today} ${names.many} to go. Split them across as many sets as you like.`}
            </p>
          </div>

          {stage === 'intro' || stage === 'denied' || stage === 'failed' ? (
            <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
              <fieldset>
                <legend className="text-sm font-semibold">Exercise</legend>
                <div className="mt-2.5 flex gap-2">
                  {(['pushups', 'situps', 'squats'] as const).map((x) => (
                    <button
                      key={x}
                      type="button"
                      aria-pressed={exercise === x}
                      disabled={!!c.exercise && c.exercise !== x}
                      onClick={() => setExercise(x)}
                      className={cx(
                        'h-10 flex-1 rounded-xl text-sm font-semibold capitalize ring-1 ring-inset transition-colors disabled:opacity-40',
                        exercise === x ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line hover:ring-slate/40',
                      )}
                    >
                      {exerciseNames[x].many}
                    </button>
                  ))}
                </div>
              </fieldset>
              <ul className="mt-5 space-y-2 text-[15px]">
                <li>Only full reps count: all the way down and back up.</li>
                <li className="flex items-start gap-2 text-slate">
                  <EyeOff size={17} className="mt-0.5 shrink-0" />
                  Video is processed on your phone and never uploaded. We keep the count and 3 small snapshots so a reviewer can check the set if needed.
                </li>
              </ul>
              <Button size="lg" className="mt-6 w-full" onClick={start}>
                <Camera size={18} /> Start a set
              </Button>
            </div>
          ) : stage === 'loading' ? (
            <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
              <Bone className="h-5 w-40" />
              <Bone className="mt-4 h-4 w-full" />
              <Bone className="mt-2 h-4 w-2/3" />
              <Button size="lg" className="mt-6 w-full" busy>
                Starting the camera
              </Button>
            </div>
          ) : stage === 'live' ? (
            <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
              <p className="text-[15px] text-slate">Keep going. Tap finish when you’re done with this set.</p>
              <Button size="lg" className="mt-5 w-full" onClick={finish}>
                Finish set
              </Button>
            </div>
          ) : (
            <div className="rounded-3xl bg-surface p-6 ring-1 ring-line/70">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-calm text-white">
                  <Check size={20} strokeWidth={3} />
                </span>
                <div>
                  <div className="text-lg font-semibold">
                    {counter.reps} {counter.reps === 1 ? names.one : names.many} counted
                  </div>
                  <div className="text-sm text-slate">in {mm}. Added to today’s total.</div>
                </div>
              </div>
              {snaps.length > 0 && (
                <>
                  <p className="mt-5 text-sm font-semibold">Kept for review</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {snaps.map((s, i) => (
                      <img key={i} src={s} alt={`Snapshot ${i + 1}`} className="aspect-[4/3] w-full -scale-x-100 rounded-lg object-cover" />
                    ))}
                  </div>
                </>
              )}
              <div className="mt-6 grid gap-2">
                <Button onClick={start} variant={today >= TARGET ? 'secondary' : 'primary'}>
                  <RotateCcw size={17} /> Another set
                </Button>
                <Button variant={today >= TARGET ? 'primary' : 'secondary'} onClick={() => navigate('/dashboard')}>
                  Done for today
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function Notice({ title, body, onRetry }: { title: string; body: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-8 text-center text-white">
      <div className="max-w-sm">
        <p className="text-lg font-semibold">{title}</p>
        <p className="mt-2 text-white/65">{body}</p>
        <Button variant="secondary" className="mt-5 ring-0" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}

const BONES: [number, number][] = [
  [11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
]

function draw(cv: HTMLCanvasElement, v: HTMLVideoElement, pose?: { x: number; y: number; visibility?: number }[]) {
  if (cv.width !== v.videoWidth) {
    cv.width = v.videoWidth
    cv.height = v.videoHeight
  }
  const ctx = cv.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, cv.width, cv.height)
  if (!pose) return
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#2b54f5'
  for (const [a, b] of BONES) {
    const p = pose[a]
    const q = pose[b]
    if ((p.visibility ?? 1) < 0.5 || (q.visibility ?? 1) < 0.5) continue
    ctx.beginPath()
    ctx.moveTo(p.x * cv.width, p.y * cv.height)
    ctx.lineTo(q.x * cv.width, q.y * cv.height)
    ctx.stroke()
  }
  ctx.fillStyle = '#e8a400'
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    const p = pose[i]
    if ((p.visibility ?? 1) < 0.5) continue
    ctx.beginPath()
    ctx.arc(p.x * cv.width, p.y * cv.height, 7, 0, Math.PI * 2)
    ctx.fill()
  }
}
