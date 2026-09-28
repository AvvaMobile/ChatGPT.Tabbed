import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export const PlusIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const CloseIcon = (props: IconProps) => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12" {...props}>
    <path d="M3 3l6 6M9 3L3 9" />
  </svg>
)

export const BackIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M10 3.5L5.5 8 10 12.5" />
  </svg>
)

export const ForwardIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
)

export const ReloadIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M13 8a5 5 0 1 1-1.46-3.54" />
    <path d="M13 2.5v3h-3" />
  </svg>
)

export const SettingsIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.47 3.47l1.13 1.13M11.4 11.4l1.13 1.13M3.47 12.53l1.13-1.13M11.4 4.6l1.13-1.13" />
  </svg>
)

export const ChatIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a1.5 1.5 0 0 1-1.5-1.5z" />
  </svg>
)

export const WarningIcon = (props: IconProps) => (
  <svg {...base} width={40} height={40} viewBox="0 0 24 24" strokeWidth={1.5} {...props}>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </svg>
)
