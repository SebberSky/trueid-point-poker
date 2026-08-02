/** App URL under Vite `base` (e.g. `/poker/api/...`). */
export function appUrl(path: string): string {
  const relative = path.replace(/^\//, '')
  const url = new URL(relative, `${window.location.origin}${import.meta.env.BASE_URL}`)
  return `${url.pathname}${url.search}`
}

/** Pathname without the Vite base prefix (no leading/trailing slashes). */
export function appPathname(): string {
  const base = String(import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  let path = window.location.pathname
  if (base && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length)
  }
  return path.replace(/^\/+|\/+$/g, '')
}
