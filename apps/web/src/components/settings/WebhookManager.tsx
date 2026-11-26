import { useState, useEffect, useCallback, useRef } from 'react'
import {
  merchantApi,
  type Webhook,
  type WebhookDeliveryLog,
  type WebhookTopic,
} from '@/api/merchant'
import { validateWebhookUrl } from '@/utils/validation'
import { maskSecret } from '@/utils/validation'
import { Badge } from '@/components/ui/badge'

export function WebhookManager() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [topics, setTopicsState] = useState<WebhookTopic[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deliveryLogs, setDeliveryLogs] = useState<WebhookDeliveryLog[]>([])
  const [formMode, setFormMode] = useState<'idle' | 'creating' | 'editing'>('idle')
  const [formUrl, setFormUrl] = useState('')
  const [formTopics, setFormTopics] = useState<string[]>([])
  const [formActive, setFormActive] = useState(true)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<{ webhookId: string; secret: string } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [walletAuthenticated, setWalletAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle')
  const [testEventId, setTestEventId] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isProduction = typeof location !== 'undefined' && location.protocol === 'https:'

  const fetchWebhooks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await merchantApi.listWebhooks()
      setWebhooks(list)
      if (!selectedId && list.length > 0) setSelectedId(list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhooks')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    fetchWebhooks()
    setTopicsState(merchantApi.getWebhookTopics())
  }, [fetchWebhooks])

  useEffect(() => {
    if (selectedId) {
      merchantApi.getDeliveryLogs(selectedId).then(setDeliveryLogs).catch(() => setDeliveryLogs([]))
    } else {
      setDeliveryLogs([])
    }
  }, [selectedId])

  const clearReveal = useCallback(() => {
    setRevealedSecret(null)
    setAcknowledged(false)
  }, [])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const handleCopy = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret)
    } catch {
      // clipboard access may be blocked; value remains visible
    }
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = setTimeout(() => {
      setRevealedSecret(null)
      setAcknowledged(false)
      copyTimeoutRef.current = null
    }, 30000)
  }

  const handleCreate = () => {
    setFormMode('creating')
    setFormUrl('')
    setFormTopics([])
    setFormActive(true)
    setUrlError(null)
  }

  const cancelForm = () => {
    setFormMode('idle')
    setUrlError(null)
  }

  const validateForm = (): boolean => {
    const result = validateWebhookUrl(formUrl, { requireHttps: isProduction })
    setUrlError(result.error)
    return result.valid
  }

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return
    setSaving(true)
    setError(null)
    try {
      if (formMode === 'creating') {
        const res = await merchantApi.createWebhook({
          url: formUrl,
          topics: formTopics,
          active: formActive,
        })
        setRevealedSecret({ webhookId: res.webhook.id, secret: res.secret })
        setAcknowledged(false)
        setFormMode('idle')
        await fetchWebhooks()
      } else if (formMode === 'editing' && selectedId) {
        await merchantApi.updateWebhook(selectedId, {
          url: formUrl,
          topics: formTopics,
          active: formActive,
        })
        setFormMode('idle')
        await fetchWebhooks()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save webhook')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this webhook? This cannot be undone.')) return
    setLoading(true)
    try {
      await merchantApi.deleteWebhook(id)
      await fetchWebhooks()
      if (selectedId === id) setSelectedId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete webhook')
    } finally {
      setLoading(false)
    }
  }

  const toggleActive = async (webhook: Webhook) => {
    setLoading(true)
    try {
      await merchantApi.updateWebhook(webhook.id, { active: !webhook.active })
      await fetchWebhooks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update webhook')
    } finally {
      setLoading(false)
    }
  }

  const authenticateWallet = async () => {
    setAuthLoading(true)
    setError(null)
    try {
      // SEP-10 / SEP-53 challenge: merchant signs a challenge with their wallet.
      // Mock: simulate a wallet signature request.
      await new Promise((resolve) => setTimeout(resolve, 800))
      setWalletAuthenticated(true)
    } catch {
      setError('Wallet authentication failed')
    } finally {
      setAuthLoading(false)
    }
  }

  const requireAuth = (action: () => Promise<void>) => {
    if (!walletAuthenticated) {
      setError('Fresh wallet signature (SEP-10 / SEP-53) required before revealing or rotating secrets.')
      return
    }
    action()
  }

  const handleReveal = async (webhook: Webhook) => {
    if (!walletAuthenticated) {
      setError('Fresh wallet signature (SEP-10 / SEP-53) required to reveal a webhook secret.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await merchantApi.rotateWebhookSecret(webhook.id)
      setRevealedSecret({ webhookId: res.webhook.id, secret: res.secret })
      setAcknowledged(false)
      await fetchWebhooks()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rotate secret')
    } finally {
      setLoading(false)
    }
  }

  const handleTestEvent = async () => {
    if (!selectedId) return
    setTestStatus('sending')
    setTestEventId(null)
    try {
      const res = await merchantApi.sendTestEvent(selectedId)
      setTestStatus('ok')
      setTestEventId(res.eventId)
      await fetchWebhooks()
      merchantApi.getDeliveryLogs(selectedId).then(setDeliveryLogs).catch(() => setDeliveryLogs([]))
    } catch (e) {
      setTestStatus('fail')
      setError(e instanceof Error ? e.message : 'Test event dispatch failed')
    } finally {
      setTimeout(() => setTestStatus('idle'), 2500)
    }
  }

  const selectedWebhook = webhooks.find((w) => w.id === selectedId)

  return (
    <section className="card">
      <div className="card-title">Webhooks</div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="alert alert-info">Loading webhooks…</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
          + Add webhook
        </button>
        <span className="small">Production requires https://</span>
      </div>

      {formMode !== 'idle' && (
        <div className="field">
          <form onSubmit={saveForm}>
            <span className="label">{formMode === 'creating' ? 'Create webhook' : 'Edit webhook'}</span>
            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                Endpoint URL
              </label>
              <input
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://example.com/webhooks"
                disabled={saving}
              />
              {urlError && <span className="small" style={{ color: '#dc2626', marginTop: 4, display: 'block' }}>{urlError}</span>}
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                Subscribed event topics
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {topics.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setFormTopics(formTopics.includes(t.value)
                        ? formTopics.filter((x) => x !== t.value)
                        : [...formTopics, t.value])
                    }}
                    className={`btn btn-outline btn-sm ${formTopics.includes(t.value) ? 'btn-primary' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="small" style={{ marginTop: 6, display: 'block' }}>
                Select the backend event topics to deliver to this endpoint.
              </span>
            </div>
            <div className="field" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
              <label className="ack">
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Active
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {formMode === 'creating' ? 'Create webhook' : 'Save changes'}
              </button>
              <button className="btn btn-outline" type="button" onClick={cancelForm} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 44 }}></th>
              <th>Endpoint URL</th>
              <th>Topics</th>
              <th style={{ width: 120 }}>Status</th>
              <th style={{ width: 160 }}>Secret</th>
              <th style={{ width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No webhooks configured. Add an endpoint to receive backend events.
                </td>
              </tr>
            ) : (
              webhooks.map((wh) => {
                const secretShown = revealedSecret?.webhookId === wh.id && acknowledged
                return (
                  <tr key={wh.id}>
                    <td>
                      <input
                        type="radio"
                        checked={selectedId === wh.id}
                        onChange={() => setSelectedId(wh.id)}
                        aria-label={`Select webhook ${wh.url}`}
                      />
                    </td>
                    <td>
                      <div className="mono" title={wh.url}>
                        {wh.url.length > 60 ? wh.url.slice(0, 60) + '…' : wh.url}
                      </div>
                    </td>
                    <td>
                      {wh.topics.map((t) => (
                        <span key={t} className="badge badge-pending" style={{ marginRight: 4, marginBottom: 4 }}>
                          {t}
                        </span>
                      ))}
                    </td>
                    <td>
                      <Badge kind={wh.active ? 'ok' : 'pending'}>{wh.active ? 'Active' : 'Inactive'}</Badge>{' '}
                      <button
                        className="btn-link btn-sm"
                        onClick={() => toggleActive(wh)}
                        disabled={saving || loading}
                      >
                        {wh.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                    <td>
                      {secretShown ? (
                        <div className="secret-cell">
                          <span>{revealedSecret?.secret}</span>
                          <button
                            className="copy-btn"
                            onClick={() => handleCopy(revealedSecret!.secret)}
                            title="Copy to clipboard"
                          >
                            Copy
                          </button>
                        </div>
                      ) : (
                        <div className="secret-cell">
                          <span className="mono">{maskSecret(wh.secret ?? '')}</span>
                          {wh.secretRevealed && !acknowledged && (
                            <span className="reveal-badge" style={{ marginLeft: 6 }}>One-time reveal</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {!revealedSecret || revealedSecret.webhookId !== wh.id ? (
                          <>
                            <button
                              className="btn btn-link btn-sm"
                              onClick={() => requireAuth(() => handleReveal(wh))}
                              disabled={loading || saving || authLoading}
                              title={walletAuthenticated ? 'Rotate secret' : 'Requires wallet signature'}
                            >
                              Rotate secret
                            </button>
                            {!walletAuthenticated && (
                              <button
                                className="btn btn-link btn-sm"
                                onClick={authenticateWallet}
                                disabled={authLoading}
                                title="Sign SEP-10 / SEP-53 challenge"
                              >
                                Authenticate wallet
                              </button>
                            )}
                          </>
                        ) : null}
                        {revealedSecret?.webhookId === wh.id && (
                          <>
                            <label className="ack">
                              <input
                                type="checkbox"
                                checked={acknowledged}
                                onChange={(e) => setAcknowledged(e.target.checked)}
                                disabled={!revealedSecret}
                              />
                              I have saved this secret
                            </label>
                            <button
                              className="btn btn-link btn-sm"
                              onClick={clearReveal}
                              title="Mask secret"
                            >
                              Mask
                            </button>
                          </>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(wh.id)}
                          disabled={loading || saving}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedWebhook && (
        <section style={{ marginTop: 20 }} className="card">
          <div className="card-title">Delivery logs &amp; test event</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <button
              className="btn btn-outline"
              onClick={handleTestEvent}
              disabled={testStatus === 'sending' || loading || saving}
            >
              {testStatus === 'sending' ? 'Sending…' : 'Send Test Event'}
            </button>
            {testStatus === 'ok' && (
              <span className="small" style={{ color: '#166534' }}>
                Test dispatched ({testEventId})
              </span>
            )}
            {testStatus === 'fail' && <span className="small" style={{ color: '#991b1b' }}>Dispatch failed</span>}
          </div>
          {deliveryLogs.length === 0 ? (
            <div className="empty">No delivery logs yet. Send a test event or wait for backend deliveries.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Topic</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 180 }}>Attempted</th>
                  <th style={{ width: 100 }}>HTTP</th>
                </tr>
              </thead>
              <tbody>
                {deliveryLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="mono">{log.eventId}</td>
                    <td className="mono">{log.topic}</td>
                    <td>
                      <Badge kind={log.status === 'delivered' ? 'ok' : log.status === 'failed' ? 'warn' : 'pending'}>
                        {log.status}
                      </Badge>
                    </td>
                    <td className="mono">{new Date(log.attemptedAt).toLocaleString()}</td>
                    <td className="mono">{log.httpStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {!walletAuthenticated && !authLoading && error && error.includes('SEP-10') ? null : null}
    </section>
  )
}
