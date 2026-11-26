import { useState, useEffect, useCallback, useRef } from 'react'
import { merchantApi, type ApiKey } from '@/api/merchant'
import { maskSecret } from '@/utils/validation'
import { Badge } from '@/components/ui/badge'

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<{ id: string; secret: string } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await merchantApi.listApiKeys()
      setKeys(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const clearReveal = useCallback(() => {
    setRevealedKey(null)
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
      // clipboard may be blocked
    }
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = setTimeout(() => {
      setRevealedKey(null)
      setAcknowledged(false)
      copyTimeoutRef.current = null
    }, 30000)
  }

  const handleCreate = () => {
    setCreating(true)
    setName('')
    setError(null)
  }

  const cancelCreate = () => setCreating(false)

  const saveKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Key name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await merchantApi.createApiKey(name.trim())
      setRevealedKey({ id: res.apiKey.id, secret: res.secret })
      setAcknowledged(false)
      setCreating(false)
      setName('')
      await fetchKeys()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create API key')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (key: ApiKey) => {
    setLoading(true)
    try {
      await merchantApi.updateApiKey(key.id, { active: !key.active })
      await fetchKeys()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update API key')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this API key? This cannot be undone.')) return
    setLoading(true)
    try {
      await merchantApi.deleteApiKey(id)
      await fetchKeys()
      if (revealedKey?.id === id) clearReveal()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete API key')
    } finally {
      setLoading(false)
    }
  }

  const secretFor = (key: ApiKey): string | null => {
    if (revealedKey && revealedKey.id === key.id && acknowledged) return revealedKey.secret
    return null
  }

  return (
    <section className="card">
      <div className="card-title">API Keys</div>
      {error && <div className="alert alert-error">{error}</div>}
      {loading && <div className="alert alert-info">Loading API keys…</div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={handleCreate} disabled={saving || creating}>
          + Create API key
        </button>
      </div>

      {creating && (
        <div className="field">
          <form onSubmit={saveKey}>
            <span className="label">Create API key</span>
            <div className="field" style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>
                Key name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production backend"
                disabled={saving}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="submit" disabled={saving || !name.trim()}>
                Create
              </button>
              <button className="btn btn-outline" type="button" onClick={cancelCreate} disabled={saving}>
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
              <th>Name</th>
              <th style={{ width: 140 }}>Prefix</th>
              <th style={{ width: 200 }}>Secret</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 150 }}>Created</th>
              <th style={{ width: 140 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No API keys yet. Create one to authenticate backend integrations.
                </td>
              </tr>
            ) : (
              keys.map((key) => {
                const secret = secretFor(key)
                return (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td className="mono">{key.prefix}</td>
                    <td>
                      {secret ? (
                        <div className="secret-cell">
                          <span>{secret}</span>
                          <button
                            className="copy-btn"
                            onClick={() => handleCopy(secret)}
                            title="Copy to clipboard"
                          >
                            Copy
                          </button>
                        </div>
                      ) : (
                        <div className="secret-cell">
                          <span className="mono">{maskSecret(key.secret ?? '')}</span>
                          {key.secret && !revealedKey ? (
                            <span className="reveal-badge" style={{ marginLeft: 6 }}>New key — reveal once</span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td>
                      <Badge kind={key.active ? 'ok' : 'pending'}>{key.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="mono">{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {revealedKey?.id === key.id && (
                          <>
                            <label className="ack">
                              <input
                                type="checkbox"
                                checked={acknowledged}
                                onChange={(e) => setAcknowledged(e.target.checked)}
                              />
                              Saved
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
                          className="btn btn-link btn-sm"
                          onClick={() => handleToggle(key)}
                          disabled={loading || saving}
                        >
                          {key.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(key.id)}
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

      {revealedKey && !acknowledged && (
        <div className="alert alert-warn" style={{ marginTop: 10 }}>
          The secret above is shown only once. Copy it and acknowledge before continuing; it will be masked
          thereafter.
        </div>
      )}
    </section>
  )
}
