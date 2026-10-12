import { ImagePlus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { useFieldError } from '../toast/context'
import { cx } from '../lib/format'
import { gsap, prefersMotion, useGSAP } from '../lib/gsap'

export interface EvidenceImage {
  id: string
  name: string
  size: number
  url: string
  file: File
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 5 * 1024 * 1024

function kb(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

/**
 * Screenshot picker for dispute evidence: click, drag and drop, or paste.
 * Previews use object URLs, which the parent revokes once images are submitted or removed.
 */
export function ImageDrop({
  value,
  onChange,
  max = 4,
  label = 'Screenshots',
  hint = 'PNG, JPG or WebP, up to 5 MB each. You can also paste a screenshot.',
}: {
  value: EvidenceImage[]
  onChange: (images: EvidenceImage[]) => void
  max?: number
  label?: string
  hint?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useFieldError()
  const id = useId()
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })

  // New thumbnails pop in.
  useGSAP(
    () => {
      if (!prefersMotion()) return
      const fresh = root.current?.querySelectorAll('[data-thumb]:not([data-seen])')
      fresh?.forEach((el) => el.setAttribute('data-seen', ''))
      if (fresh?.length) gsap.from(fresh, { scale: 0.8, autoAlpha: 0, duration: 0.35, stagger: 0.05, ease: 'back.out(2)', clearProps: 'all' })
    },
    { scope: root, dependencies: [value.length] },
  )

  function add(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return
    const room = max - latest.current.length
    const next: EvidenceImage[] = []
    let problem = ''
    for (const f of list) {
      if (!TYPES.includes(f.type)) {
        problem = `${f.name || 'That file'} isn’t a PNG, JPG or WebP image.`
        continue
      }
      if (f.size > MAX_BYTES) {
        problem = `${f.name} is ${kb(f.size)}. Each image must be under 5 MB.`
        continue
      }
      if (next.length >= room) {
        problem = `You can add up to ${max} images.`
        break
      }
      next.push({ id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 7)}`, name: f.name || 'Pasted screenshot', size: f.size, url: URL.createObjectURL(f), file: f })
    }
    setError(problem)
    if (next.length) onChange([...latest.current, ...next])
  }

  function remove(img: EvidenceImage) {
    URL.revokeObjectURL(img.url)
    setError('')
    onChange(latest.current.filter((x) => x.id !== img.id))
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    add(e.dataTransfer.files)
  }

  function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData.items)
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length) {
      e.preventDefault()
      add(files)
    }
  }

  const full = value.length >= max

  return (
    <div ref={root} onPaste={onPaste}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <span className="text-xs text-slate tabular">
          {value.length} of {max}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-slate">{hint}</p>

      {!full && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cx(
            'mt-2.5 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors',
            over ? 'border-cobalt bg-cobalt-soft' : error ? 'border-miss bg-ground' : 'border-line bg-ground hover:border-slate/40',
          )}
        >
          <span className={cx('grid size-10 place-items-center rounded-xl', over ? 'bg-cobalt text-white' : 'bg-surface text-slate ring-1 ring-line')}>
            <ImagePlus size={20} />
          </span>
          <span className="text-[15px] font-semibold">{over ? 'Drop to add' : 'Add screenshots'}</span>
          <span className="text-sm text-slate">Click to choose, or drag them here</span>
        </button>
      )}
      <input
        id={id}
        ref={input}
        type="file"
        accept={TYPES.join(',')}
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files) add(e.target.files)
          e.target.value = ''
        }}
      />

      {value.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {value.map((img) => (
            <li key={img.id} data-thumb className="group relative overflow-hidden rounded-xl bg-ground ring-1 ring-line">
              <img src={img.url} alt={img.name} className="aspect-[4/3] w-full object-cover" />
              <span className="block truncate px-2 py-1.5 text-xs text-slate">
                {img.name}, {kb(img.size)}
              </span>
              <button
                type="button"
                onClick={() => remove(img)}
                aria-label={`Remove ${img.name}`}
                className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-ink/75 text-white backdrop-blur-sm transition-colors hover:bg-ink"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
