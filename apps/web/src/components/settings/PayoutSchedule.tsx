import { useState, useEffect, useCallback } from 'react'
import { merchantApi, type PayoutSchedule, type SettlementAsset } from '@/api/merchant'

export function PayoutScheduleCard() {
  const [schedule, setSchedule] = useState<PayoutSchedule | null>(null)
  const [editFreq, setEditFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [editThreshold, setEditThreshold] = useState('')
  const [editAsset, setEditAsset] = useState<'USDC' | 'USDT' | 'ETH' | 'BTC'>('USDC')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggered, setTriggered] = useState<{ triggered: boolean; scheduledAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ASSETS: { value: SettlementAsset; label: string }[] = [
    { value: 'USDC', label: 'USDC' },
    { value: 'USDT', label: 'USDT' },
    { value: 'ETH', label: 'ETH' },
    { value: 'BTC', label: 'BTC' },
  ]

  const fetchSchedule = useCallback(async () => {
    setError(null)
    try {
      const s = await merchantApi.getPayoutSchedule()
      setSchedule(s)
      setEditFreq(s.frequency)
      setEditThreshold(s.minimumThreshold)
      setEditAsset(s.settlementAsset)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payout schedule')
    }
  }, [])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  const startEdit = () => {
    if (!schedule) return
    setEditFreq(schedule.frequency)
    setEditThreshold(schedule.minimumThreshold)
    setEditAsset(schedule.settlementAsset)
    setEditing(true)
    setError(null)
  }

  const cancelEdit = () => setEditing(false)

  const saveSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const s = await merchantApi.setPayoutSchedule({
        frequency: editFreq,
        minimumThreshold: editThreshold,
        settlementAsset: editAsset,
      })
      setSchedule(s)
      setEditing(false)
      setTriggered(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update payout schedule')
    } finally {
      setSaving(false)
    }
  }

  const handleTrigger = async () => {
    setTriggering(true)
    setError(null)
    setTriggered(null)
    try {
      const res = await merchantApi.triggerScheduledPayout()
      setTriggered(res)
      await fetchSchedule()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trigger payout')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">Payout Schedule</div>
      {error && <div className="alert alert-error">{error}</div>}

      {schedule && (
        <>
          <div className="grid-2">
            <div className="field">
              <span className="label">Frequency</span>
              <span className="v">{schedule.frequency}</span>
            </div>
            <div className="field">
              <span className="label">Minimum threshold</span>
              <span className="v">{schedule.minimumThreshold} USDC</span>
            </div>
            <div className="field">
              <span className="label">Settlement asset</span>
              <span className="v">{schedule.settlementAsset}</span>
            </div>
            <div className="field">
              <span className="label">Last triggered</span>
              <span className="v">{schedule.lastTriggeredAt ? new Date(schedule.lastTriggeredAt).toLocaleString() : '—'}</span>
            </div>
            <div className="field">
              <span className="label">Next settlement</span>
              <span className="v">{schedule.nextSettlementAt ? new Date(schedule.nextSettlementAt).toLocaleString() : '—'}</span>
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={startEdit} disabled={saving || triggering}>
              Edit schedule
            </button>
            <button
              className="btn btn-primary"
              onClick={handleTrigger}
              disabled={saving || triggering}
            >
              {triggering ? 'Triggering…' : 'Trigger scheduled payout'}
            </button>
          </div>

          {triggered && (
            <div className="alert alert-info" style={{ marginTop: 10 }}>
              Payout triggered at {new Date(triggered.scheduledAt).toLocaleString()}
            </div>
          )}
        </>
      )}

      {editing && (
        <div style={{ marginTop: 14 }} className="field">
          <form onSubmit={saveSchedule}>
            <span className="label">Update payout schedule</span>
            <div className="field" style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                  Frequency
                </label>
                <select value={editFreq} onChange={(e) => setEditFreq(e.target.value as any)} disabled={saving}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                  Minimum threshold
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editThreshold}
                  onChange={(e) => setEditThreshold(e.target.value)}
                  placeholder="0"
                  disabled={saving}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                  Settlement asset
                </label>
                <select value={editAsset} onChange={(e) => setEditAsset(e.target.value as any)} disabled={saving}>
                  {ASSETS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                Save
              </button>
              <button className="btn btn-outline" type="button" onClick={cancelEdit} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
