import type { ReactNode } from 'react'

const THEMES: Record<string, { bg: string; ink: string }> = {
  '0': { bg: '#e7eef6', ink: '#31445c' },
  '½': { bg: '#fff3c4', ink: '#6b4a12' },
  '1': { bg: '#d7f3dc', ink: '#215534' },
  '2': { bg: '#ffd6e3', ink: '#7a2748' },
  '3': { bg: '#d4ecff', ink: '#1d4f7a' },
  '5': { bg: '#ffe0c4', ink: '#7a3e12' },
  '8': { bg: '#e4d6ff', ink: '#4a2d7a' },
  '13': { bg: '#d8ead2', ink: '#2f5a32' },
  '21': { bg: '#ffe9c8', ink: '#6b3f12' },
  '34': { bg: '#ffd4c8', ink: '#7a2e22' },
  '?': { bg: '#ece4f6', ink: '#4a3568' },
  '☕': { bg: '#f3e4d2', ink: '#5c3a22' },
}

const FALLBACK = { bg: '#f6eefb', ink: '#1a1024' }

export function cardTheme(value: string | null | undefined) {
  if (!value) return FALLBACK
  return THEMES[value] ?? FALLBACK
}

function Art({ children }: { children: ReactNode }) {
  return (
    <svg className="card-art" viewBox="0 0 64 64" aria-hidden="true">
      {children}
    </svg>
  )
}

function artFor(value: string) {
  switch (value) {
    case '0':
      return (
        <Art>
          <circle cx="32" cy="32" r="16" fill="none" stroke="#8aa0b8" strokeWidth="5" />
          <circle cx="32" cy="32" r="6" fill="#c5d4e4" />
        </Art>
      )
    case '½':
      return (
        <Art>
          <circle cx="32" cy="34" r="16" fill="#f2c14e" />
          <path d="M32 18a16 16 0 0 0 0 32V18Z" fill="#fff4d2" />
          <circle cx="26" cy="28" r="2.2" fill="#d9a43a" />
          <circle cx="38" cy="36" r="1.8" fill="#d9a43a" />
        </Art>
      )
    case '1':
      return (
        <Art>
          <path d="M32 48c0-10 8-14 8-22a8 8 0 1 0-16 0c0 8 8 12 8 22Z" fill="#5bbf72" />
          <circle cx="32" cy="20" r="5" fill="#f06c8a" />
          <path d="M24 50h16" stroke="#3d8a52" strokeWidth="3" strokeLinecap="round" />
        </Art>
      )
    case '2':
      return (
        <Art>
          <circle cx="24" cy="28" r="9" fill="#e24b6a" />
          <circle cx="40" cy="28" r="9" fill="#c81e4a" />
          <path d="M32 34c0 8 4 14 8 16" fill="none" stroke="#3d7a3a" strokeWidth="3" strokeLinecap="round" />
          <path d="M32 34c0 6-3 12-8 15" fill="none" stroke="#3d7a3a" strokeWidth="3" strokeLinecap="round" />
        </Art>
      )
    case '3':
      return (
        <Art>
          <circle cx="20" cy="24" r="8" fill="#ff6b8a" />
          <circle cx="44" cy="22" r="8" fill="#5aa9ff" />
          <circle cx="32" cy="34" r="8" fill="#ffd166" />
          <path d="M20 32v18M44 30v20M32 42v12" stroke="#8a6a4a" strokeWidth="2" strokeLinecap="round" />
        </Art>
      )
    case '5':
      return (
        <Art>
          <polygon
            points="32,10 38,26 55,26 41,36 46,52 32,42 18,52 23,36 9,26 26,26"
            fill="#f4a261"
          />
          <circle cx="32" cy="32" r="5" fill="#ffe0b8" />
        </Art>
      )
    case '8':
      return (
        <Art>
          <circle cx="32" cy="24" r="11" fill="#7b5cff" />
          <circle cx="27" cy="22" r="2.2" fill="#1a1024" />
          <circle cx="37" cy="22" r="2.2" fill="#1a1024" />
          <path
            d="M22 32c-6 8-2 18 4 16M26 34c-2 10 4 16 8 12M38 34c2 10-4 16-8 12M42 32c6 8 2 18-4 16"
            fill="none"
            stroke="#7b5cff"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </Art>
      )
    case '13':
      return (
        <Art>
          <ellipse cx="32" cy="36" rx="16" ry="14" fill="#3d3a44" />
          <circle cx="20" cy="22" r="6" fill="#3d3a44" />
          <circle cx="44" cy="22" r="6" fill="#3d3a44" />
          <circle cx="26" cy="34" r="2.4" fill="#f6eefb" />
          <circle cx="38" cy="34" r="2.4" fill="#f6eefb" />
          <path d="M28 42c2.4 3 5.6 3 8 0" fill="none" stroke="#f6eefb" strokeWidth="2" strokeLinecap="round" />
        </Art>
      )
    case '21':
      return (
        <Art>
          <rect x="14" y="16" width="22" height="32" rx="3" fill="#fff" stroke="#c81e4a" strokeWidth="2" transform="rotate(-12 25 32)" />
          <rect x="28" y="16" width="22" height="32" rx="3" fill="#fff" stroke="#1d4f91" strokeWidth="2" transform="rotate(10 39 32)" />
          <circle cx="24" cy="30" r="4" fill="#c81e4a" />
          <circle cx="40" cy="34" r="4" fill="#1d4f91" />
        </Art>
      )
    case '34':
      return (
        <Art>
          <ellipse cx="34" cy="38" rx="16" ry="10" fill="#2a9d8f" />
          <circle cx="48" cy="24" r="8" fill="#2a9d8f" />
          <rect x="16" y="36" width="6" height="12" rx="2" fill="#1d6f64" />
          <rect x="26" y="38" width="6" height="12" rx="2" fill="#1d6f64" />
          <rect x="36" y="38" width="6" height="12" rx="2" fill="#1d6f64" />
          <path d="M54 22c6-2 8 4 6 8" fill="none" stroke="#2a9d8f" strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="22" r="1.6" fill="#1a1024" />
        </Art>
      )
    case '?':
      return (
        <Art>
          <circle cx="32" cy="30" r="16" fill="#c4b5e8" />
          <circle cx="26" cy="26" r="2.2" fill="#1a1024" />
          <circle cx="38" cy="26" r="2.2" fill="#1a1024" />
          <path d="M26 38c3 4 9 4 12 0" fill="none" stroke="#1a1024" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="48" cy="14" r="8" fill="#fff" />
          <path d="M45.5 10.5c0-1.6 1.2-2.6 2.5-2.6s2.5 1 2.5 2.6c0 1.6-2.5 2.4-2.5 4.2" fill="none" stroke="#4a3568" strokeWidth="2" strokeLinecap="round" />
          <circle cx="48" cy="18.6" r="1.3" fill="#4a3568" />
        </Art>
      )
    case '☕':
      return (
        <Art>
          <path d="M18 30h24v12a10 10 0 0 1-24 0Z" fill="#7a4a2a" />
          <path d="M42 32h6a6 6 0 0 1 0 12h-6" fill="none" stroke="#7a4a2a" strokeWidth="3" />
          <rect x="16" y="28" width="28" height="6" rx="2" fill="#c4894a" />
          <path d="M24 18c0 4 4 4 4 8M32 16c0 5 5 5 5 10" fill="none" stroke="#b8c4d4" strokeWidth="2.4" strokeLinecap="round" />
        </Art>
      )
    default:
      return (
        <Art>
          <circle cx="32" cy="32" r="14" fill="#d9c6ef" />
        </Art>
      )
  }
}

export function CardArt({ value }: { value: string }) {
  return artFor(value)
}

export function CardBackArt() {
  return (
    <svg className="card-art card-art-back" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="8" fill="#6b21a8" />
      <rect x="12" y="12" width="40" height="40" rx="6" fill="none" stroke="#f6eefb" strokeWidth="2" />
      <circle cx="32" cy="32" r="10" fill="#fb7185" />
      <circle cx="32" cy="32" r="5" fill="#f6eefb" />
    </svg>
  )
}
