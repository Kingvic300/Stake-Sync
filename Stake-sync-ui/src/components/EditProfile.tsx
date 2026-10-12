import { Camera } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context'
import { squareThumb } from '../lib/avatar'
import { cx } from '../lib/format'
import { ApiError } from '../lib/api'
import { reportError } from '../lib/report'
import { inputClass } from '../lib/styles'
import { Sheet } from './Sheet'
import { Avatar, Button, Field } from './ui'
import { useToast } from '../toast/context'

const BIO_MAX = 160

export function EditProfileSheet({ onClose }: { onClose: () => void }) {
  const { session, updateProfile } = useAuth()
  const [name, setName] = useState(session?.name ?? '')
  const [username, setUsername] = useState(session?.username ?? '')
  const [bio, setBio] = useState(session?.bio ?? '')
  const [avatar, setAvatar] = useState(session?.avatar)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)
  const usernameOk = /^[a-z0-9_]{3,20}$/.test(username)
  const valid = name.trim().length > 0 && usernameOk && bio.length <= BIO_MAX

  async function pick(f: File | undefined) {
    if (!f) return
    const photoError = (title: string) => toast({ tone: 'error', title, inbox: false })
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return photoError('Use a PNG, JPG or WebP image.')
    if (f.size > 8 * 1024 * 1024) return photoError('That photo is over 8 MB. Try a smaller one.')
    try {
      setAvatar(await squareThumb(f))
    } catch (e) {
      reportError(e, { where: 'avatar' })
      photoError('We couldn’t read that image. Try another photo.')
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      await updateProfile({ name: name.trim(), username, bio: bio.trim(), avatar })
    } catch (err) {
      setSaving(false)
      return toast({ tone: 'error', title: 'Couldn’t save your profile', body: err instanceof ApiError ? err.message : 'Please try again.', inbox: false })
    }
    setSaving(false)
    setSaved(true)
    toast({ title: 'Profile updated' })
    window.setTimeout(onClose, 600)
  }

  return (
    <Sheet
      title="Edit profile"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-profile" className="flex-1" disabled={!valid} busy={saving}>
            {saved ? 'Saved' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <form id="edit-profile" onSubmit={save} className="space-y-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => file.current?.click()}
            className="group relative rounded-full focus-visible:outline-2"
            aria-label="Change profile photo"
          >
            <Avatar person={{ name: name || 'You', handle: '', hue: 230 }} src={avatar} size={72} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Camera size={20} />
            </span>
          </button>
          <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
                {avatar ? 'Change photo' : 'Add a photo'}
              </Button>
              {avatar && (
                <Button size="sm" variant="ghost" onClick={() => setAvatar(undefined)}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-sm text-slate">A square photo works best.</p>
          </div>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputClass} />
        </Field>

        <Field label="Username" hint="3 to 20 letters, numbers or underscores">
          <div className="relative">
            <span className="absolute top-1/2 left-4 -translate-y-1/2 text-slate">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              aria-invalid={!usernameOk}
              className={cx(inputClass, 'pl-9')}
            />
          </div>
        </Field>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="bio" className="text-sm font-semibold">
              Bio
            </label>
            <span className={cx('text-xs tabular', bio.length > BIO_MAX ? 'text-miss' : 'text-slate')}>
              {bio.length} / {BIO_MAX}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate">A line about you. Shown on your profile and invites.</p>
          <textarea
            id="bio"
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Backend engineer in Lagos. Writing Solana programs after hours."
            aria-invalid={bio.length > BIO_MAX}
            className={cx(inputClass, 'mt-2 resize-none')}
          />
        </div>
      </form>
    </Sheet>
  )
}
