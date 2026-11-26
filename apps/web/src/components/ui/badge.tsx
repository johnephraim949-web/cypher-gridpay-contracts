export type BadgeKind = 'ok' | 'warn' | 'pending' | 'level'

interface BadgeProps {
  kind: BadgeKind
  children: React.ReactNode
  className?: string
}

const VARIANTS: Record<BadgeKind, string> = {
  ok: 'badge badge-ok',
  warn: 'badge badge-warn',
  pending: 'badge badge-pending',
  level: 'badge badge-level',
}

export function Badge({ kind, children, className }: BadgeProps) {
  return (
    <span className={`${VARIANTS[kind]} ${className ?? ''}`}>
      {children}
    </span>
  )
}
