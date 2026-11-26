import { useState, useEffect, useCallback } from 'react'
import { merchantApi, type TierLimits, type AddressRateLimit } from '@/api/merchant'
import { Badge } from '@/components/ui/badge'
import { Meter } from '@/components/ui/meter'

interface VerificationLimitsCardProps {
  onRefresh?: () => void
}

export function VerificationLimitsCard({ onRefresh }: VerificationLimitsCardProps = {}) {
  const [level, setLevel] = useState<{
    level: number
    label: string
    tier: string
    kycStatus: string
    onchainVerified: boolean
  } | null>(null)
  const [limits, setLimits] = useState<TierLimits | null>(null)
  const [rateLimit, setRateLimit] = useState<AddressRateLimit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [lvl, lim, rl] = await Promise.all([
        merchantApi.getVerificationLevel(),
        merchantApi.getTierLimits(),
        merchantApi.getAddressRateLimit(),
      ])
      setLevel(lvl)
      setLimits(lim)
      setRateLimit(rl)
      onRefresh?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load verification and limits')
    } finally {
      setLoading(false)
    }
  }, [onRefresh])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const resetAt = rateLimit ? new Date(rateLimit.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <section className="card">
      <div className="card-title">Verification &amp; Limits</div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="alert alert-info">Loading verification data…</div>}

      <div className="grid-2" style={{ marginTop: loading || error ? 0 : 12 }}>
        {level && (
          <div className="field">
            <span className="label">Verification level</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Badge kind={level.onchainVerified ? 'ok' : 'warn'}>{level.tier}</Badge>
              <span className="small">{level.label} &middot; KYC {level.kycStatus}</span>
              {!level.onchainVerified && (
                <span className="small" style={{ color: '#dc2626' }}>Not on-chain verified</span>
              )}
            </div>
          </div>
        )}
        {rateLimit && (
          <div className="field">
            <span className="label">Rate-limit window</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Badge kind={rateLimit.limited ? 'warn' : 'ok'}>
                {rateLimit.limited ? 'LIMITED' : 'OK'}
              </Badge>
              <span className="small">
                {rateLimit.requestsRemaining} remaining &middot; resets {resetAt}
              </span>
            </div>
          </div>
        )}
      </div>

      {limits && (
        <div className="field" style={{ marginTop: 16 }}>
          <span className="label">Daily rolling volume ({limits.currency})</span>
          <div className="meter-label">
            <span>Used {limits.dailyUsed} / {limits.dailyRollingLimit}</span>
            <span>{limits.utilizationPct.toFixed(1)}% utilized</span>
          </div>
          <div className="meter">
            <Meter
              value={limits.utilizationPct}
              warnThreshold={75}
              dangerThreshold={90}
            />
          </div>
          <div className="kv">
            <div className="kv-item">
              <span className="k">Per-transaction limit</span>
              <span className="v">{limits.perTransactionLimit}</span>
            </div>
            <div className="kv-item">
              <span className="k">Daily remaining</span>
              <span className="v">{limits.dailyRemaining}</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-outline btn-sm" onClick={fetchData} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </section>
  )
}
