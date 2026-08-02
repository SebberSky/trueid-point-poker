/** Funnel mount prefix from the browser path (`/poker`, or '' on localhost). */
export function mountPrefix(): string {
  const path = window.location.pathname
  if (path === '/poker' || path.startsWith('/poker/')) return '/poker'
  return ''
}

/** Browser URL for API/assets under Funnel (`/poker/api/...`) or local (`/api/...`). */
export function appUrl(path: string): string {
  const clean = path.replace(/^\//, '')
  const mount = mountPrefix()
  return `${mount}/${clean}`.replace(/\/{2,}/g, '/')
}

/** Pathname without `/poker` mount (no leading/trailing slashes). */
export function appPathname(): string {
  let path = window.location.pathname
  const mount = mountPrefix()
  if (mount && (path === mount || path.startsWith(`${mount}/`))) {
    path = path.slice(mount.length)
  }
  return path.replace(/^\/+|\/+$/g, '')
}
