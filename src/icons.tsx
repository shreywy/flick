import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

const stroke = (size: number, rest: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
})

export const Play = ({ size = 22, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...r}>
    <path d="M6 3.5v17l14.5-8.5z" fill="currentColor" />
  </svg>
)
export const Pause = ({ size = 22, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...r}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" />
  </svg>
)
export const Search = ({ size = 24, ...r }: P) => (
  <svg {...stroke(size, r)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.5 16.5L21 21" />
  </svg>
)
export const Sliders = ({ size = 24, ...r }: P) => (
  <svg {...stroke(size, r)}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
)
export const Back = ({ size = 24, ...r }: P) => (
  <svg {...stroke(size, r)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)
export const Chevron = ({ size = 16, dir = 'right', ...r }: P & { dir?: 'right' | 'left' | 'down' }) => (
  <svg {...stroke(size, { strokeWidth: 2, ...r })}>
    <path d={dir === 'right' ? 'M9 6l6 6-6 6' : dir === 'left' ? 'M15 6l-6 6 6 6' : 'M6 9l6 6 6-6'} />
  </svg>
)
export const Check = ({ size = 20, ...r }: P) => (
  <svg {...stroke(size, { strokeWidth: 2.4, ...r })}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)
export const Close = ({ size = 20, ...r }: P) => (
  <svg {...stroke(size, r)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const Captions = ({ size = 24, ...r }: P) => (
  <svg {...stroke(size, { strokeWidth: 1.7, ...r })}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M10.5 10.2a2 2 0 1 0 0 3.6M16.5 10.2a2 2 0 1 0 0 3.6" />
  </svg>
)
export const Volume = ({ size = 24, muted, ...r }: P & { muted?: boolean }) => (
  <svg {...stroke(size, { strokeWidth: 1.7, ...r })}>
    <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
  </svg>
)
export const Fullscreen = ({ size = 22, exit, ...r }: P & { exit?: boolean }) => (
  <svg {...stroke(size, r)}>
    <path d={exit ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
  </svg>
)
export const Skip = ({ size = 26, back, ...r }: P & { back?: boolean }) => (
  <svg {...stroke(size, { strokeWidth: 1.7, ...r })}>
    {back ? (
      <>
        <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
        <path d="M4.5 4v4h4" />
      </>
    ) : (
      <>
        <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
        <path d="M19.5 4v4h-4" />
      </>
    )}
    <text x="12" y="15" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="sans-serif">
      10
    </text>
  </svg>
)
export const Next = ({ size = 24, ...r }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...r}>
    <path d="M5 4.5v15l11-7.5z" />
    <rect x="17" y="4.5" width="2.5" height="15" rx="1" />
  </svg>
)
export const Download = ({ size = 18, ...r }: P) => (
  <svg {...stroke(size, { strokeWidth: 2, ...r })}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
)
export const Alert = ({ size = 20, ...r }: P) => (
  <svg {...stroke(size, { strokeWidth: 2, ...r })}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </svg>
)
export const Spinner = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="2.4" className="spin" aria-hidden>
    <circle cx="12" cy="12" r="8" stroke="rgba(238,234,227,0.18)" />
    <path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" strokeLinecap="round" />
  </svg>
)
