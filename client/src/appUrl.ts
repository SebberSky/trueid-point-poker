/** Funnel mount prefix (`/poker`). */
export function mountPrefix(): string {
  return '/poker'
}

/** Browser URL under /poker (e.g. `/poker/api/...`). */
export function appUrl(path: string): string {
  const clean = path.replace(/^\//, '')
  return `/poker/${clean}`.replace(/\/{2,}/g, '/')
}

/** Pathname without `/poker` (no leading/trailing slashes). */
export function appPathname(): string {
  let path = window.location.pathname
  if (path === '/poker' || path.startsWith('/poker/')) {
    path = path.slice('/poker'.length)
  }
  return path.replace(/^\/+|\/+$/g, '')
}
