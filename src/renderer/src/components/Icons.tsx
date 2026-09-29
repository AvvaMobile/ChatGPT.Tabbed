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
  <svg {...base} width={17} height={17} viewBox="0 0 24 24" strokeWidth={1.9} {...props}>
    <path d="M19.08 9.23 L21.84 10.24 L21.84 13.76 L19.08 14.77 L18.96 15.05 L20.20 17.72 L17.72 20.20 L15.05 18.96 L14.77 19.08 L13.76 21.84 L10.24 21.84 L9.23 19.08 L8.95 18.96 L6.28 20.20 L3.80 17.72 L5.04 15.05 L4.92 14.77 L2.16 13.76 L2.16 10.24 L4.92 9.23 L5.04 8.95 L3.80 6.28 L6.28 3.80 L8.95 5.04 L9.23 4.92 L10.24 2.16 L13.76 2.16 L14.77 4.92 L15.05 5.04 L17.72 3.80 L20.20 6.28 L18.96 8.95Z" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
)

export const SplitIcon = (props: IconProps) => (
  <svg {...base} width={17} height={17} viewBox="0 0 24 24" strokeWidth={1.9} {...props}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M12 4.5v15" />
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
