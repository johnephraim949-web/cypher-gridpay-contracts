export type BadgeKind = 'ok' | 'warn' | 'pending' | 'level'

interface MeterProps {
  value: number
  warnThreshold?: number
  dangerThreshold?: number
  className?: string
}

export function Meter({ value, warnThreshold = 75, dangerThreshold = 90, className }: MeterProps) {
  let kind: 'default' | 'warn' | 'danger' = 'default'
  if (value >= dangerThreshold) kind = 'danger'
  else if (value >= warnThreshold) kind = 'warn'

  return (
    <div className={`meter ${className ?? ''}`}>
      <div className={`meter-bar ${kind}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}
