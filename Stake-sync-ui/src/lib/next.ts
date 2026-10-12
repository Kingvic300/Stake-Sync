// Where to send someone after they sign up or log in from an invite.
const KEY = 'stakesync.next'

export function rememberNext(path: string) {
  try {
    sessionStorage.setItem(KEY, path)
  } catch {
    // storage blocked: they land on the overview instead
  }
}

export function takeNext(): string | null {
  try {
    const v = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return v && v.startsWith('/') ? v : null
  } catch {
    return null
  }
}
