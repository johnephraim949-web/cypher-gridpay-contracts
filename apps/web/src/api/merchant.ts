import { ApiClient, HttpMethod } from './client'

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type VerificationLevel = 1 | 2 | 3 | 4 | 5

export interface MerchantVerificationLevel {
  level: VerificationLevel
  label: string
  tier: string
  kycStatus: 'pending' | 'verified' | 'rejected'
  onchainVerified: boolean
}

export interface TierLimits {
  currency: string
  perTransactionLimit: string
  dailyRollingLimit: string
  dailyUsed: string
  dailyRemaining: string
  utilizationPct: number
}

export interface AddressRateLimit {
  windowSeconds: number
  requestsRemaining: number
  resetAt: number
  limited: boolean
}

export type PayoutFrequency = 'daily' | 'weekly' | 'monthly'
export type SettlementAsset = 'USDC' | 'USDT' | 'ETH' | 'BTC'

export interface PayoutSchedule {
  frequency: PayoutFrequency
  minimumThreshold: string
  settlementAsset: SettlementAsset
  lastTriggeredAt?: string
  nextSettlementAt?: string
}

export interface WebhookTopic {
  value: string
  label: string
}

export interface Webhook {
  id: string
  url: string
  topics: string[]
  active: boolean
  /** Plaintext HMAC secret, only populated on create/rotate response. Null thereafter. */
  secret: string | null
  secretRevealed: boolean
  createdAt: string
  updatedAt: string
}

export interface WebhookDeliveryLog {
  id: string
  eventId: string
  topic: string
  status: 'pending' | 'delivered' | 'failed'
  httpStatus?: number
  attemptedAt: string
  responseBody?: string
}

export interface WebhookWithLogs extends Webhook {
  deliveryLogs: WebhookDeliveryLog[]
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  /** Plaintext secret, only populated on create response. Null thereafter. */
  secret: string | null
  active: boolean
  createdAt: string
  lastUsedAt?: string
}

/* ------------------------------------------------------------------ */
/* Mock backend                                                       */
/* ------------------------------------------------------------------ */

const WEBHOOK_TOPICS: WebhookTopic[] = [
  { value: 'payment.received', label: 'Payment Received' },
  { value: 'payment.failed', label: 'Payment Failed' },
  { value: 'payout.completed', label: 'Payout Completed' },
  { value: 'payout.failed', label: 'Payout Failed' },
  { value: 'chargeback.created', label: 'Chargeback Created' },
  { value: 'chargeback.resolved', label: 'Chargeback Resolved' },
  { value: 'dispute.opened', label: 'Dispute Opened' },
  { value: 'dispute.closed', label: 'Dispute Closed' },
  { value: 'account.updated', label: 'Account Updated' },
]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}`
}

export class MerchantApi extends ApiClient {
  private webhooks: Webhook[] = []
  private apiKeys: ApiKey[] = []
  private payoutSchedule: PayoutSchedule = {
    frequency: 'weekly',
    minimumThreshold: '100.00',
    settlementAsset: 'USDC',
  }

  constructor(isProduction = false) {
    super('', isProduction)
    this.seed()
  }

  private seed(): void {
    this.webhooks = [
      {
        id: 'wh_1',
        url: 'https://merchant.example.com/webhooks/payments',
        topics: ['payment.received', 'payout.completed'],
        active: true,
        secret: null,
        secretRevealed: false,
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
    ]
    this.apiKeys = [
      {
        id: 'key_1',
        name: 'Production Key',
        prefix: 'pk_live_',
        secret: null,
        active: true,
        createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
      },
    ]
  }

  /* ------------------------------------------------------------------ */
  /* Request                                                            */
  /* ------------------------------------------------------------------ */

  protected async request<T>(
    path: string,
    opts: { method?: HttpMethod; body?: unknown } = {},
  ): Promise<T> {
    await delay(350)
    // Simulate occasional transient failure for realism
    if (Math.random() < 0.02) {
      const err = new Error('API error 500: Internal Server Error') as Error & { status?: number }
      err.status = 500
      throw err
    }
    const method = opts.method ?? 'GET'
    let result: unknown
    try {
      result = this.dispatch(method, path, opts.body)
    } catch (e) {
      throw e
    }
    return result as T
  }

  private dispatch(method: HttpMethod, path: string, body?: unknown): unknown {
    if (method === 'GET' && path === '/api/merchant/verification-level') {
      return {
        level: 3,
        label: 'Verified Merchant',
        tier: 'Tier 3',
        kycStatus: 'verified',
        onchainVerified: true,
      }
    }
    if (method === 'GET' && path === '/api/merchant/tier-limits') {
      return {
        currency: 'USDC',
        perTransactionLimit: '5,000.00',
        dailyRollingLimit: '50,000.00',
        dailyUsed: '12,450.00',
        dailyRemaining: '37,550.00',
        utilizationPct: 24.9,
      }
    }
    if (method === 'GET' && path === '/api/merchant/rate-limit') {
      return {
        windowSeconds: 60,
        requestsRemaining: 42,
        resetAt: Date.now() + 30000,
        limited: false,
      }
    }
    if (method === 'GET' && path === '/api/merchant/payout-schedule') {
      return this.payoutSchedule
    }
    if (method === 'POST' && path === '/api/merchant/payout-schedule') {
      this.payoutSchedule = { ...this.payoutSchedule, ...(body as object) }
      return this.payoutSchedule
    }
    if (method === 'POST' && path === '/api/merchant/payout-schedule/trigger') {
      this.payoutSchedule.lastTriggeredAt = new Date().toISOString()
      return { triggered: true, scheduledAt: this.payoutSchedule.lastTriggeredAt }
    }
    if (method === 'GET' && path === '/api/merchant/webhooks') {
      return this.webhooks.map((w) => ({ ...w, secret: null }))
    }
    if (method === 'GET' && path.match(/^\/api\/merchant\/webhooks\/[^\/]+\/logs$/)) {
      const webhookId = path.split('/')[4]
      const w = this.webhooks.find((x) => x.id === webhookId)
      if (!w) throwObjectNotFound()
      return generateDeliveryLogs(webhookId)
    }
    if (method === 'GET' && path.startsWith('/api/merchant/webhooks/')) {
      const id = path.split('/').pop()!
      const w = this.webhooks.find((x) => x.id === id)
      if (!w) throwObjectNotFound()
      return { ...w, secret: null }
    }
    if (method === 'POST' && path === '/api/merchant/webhooks') {
      const { url, topics, active } = body as { url: string; topics: string[]; active?: boolean }
      const webhook: Webhook = {
        id: randomId('wh'),
        url,
        topics: topics ?? [],
        active: active ?? true,
        secret: randomSecret(),
        secretRevealed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      this.webhooks.push(webhook)
      return { webhook: { ...webhook }, secret: webhook.secret }
    }
    if (method === 'PUT' && path.startsWith('/api/merchant/webhooks/')) {
      const id = path.split('/').pop()!
      const idx = this.webhooks.findIndex((x) => x.id === id)
      if (idx === -1) throwObjectNotFound()
      const { url, topics, active } = body as Partial<Webhook>
      this.webhooks[idx] = {
        ...this.webhooks[idx],
        ...(url !== undefined ? { url } : {}),
        ...(topics !== undefined ? { topics } : {}),
        ...(active !== undefined ? { active } : {}),
        updatedAt: new Date().toISOString(),
      }
      return { ...this.webhooks[idx], secret: null }
    }
    if (method === 'DELETE' && path.startsWith('/api/merchant/webhooks/')) {
      const id = path.split('/').pop()!
      const idx = this.webhooks.findIndex((x) => x.id === id)
      if (idx === -1) throwObjectNotFound()
      this.webhooks.splice(idx, 1)
      return { deleted: true }
    }
    if (method === 'POST' && path.startsWith('/api/merchant/webhooks/') && path.endsWith('/rotate-secret')) {
      const id = path.split('/').pop()!.replace('/rotate-secret', '')
      const idx = this.webhooks.findIndex((x) => x.id === id)
      if (idx === -1) throwObjectNotFound()
      const secret = randomSecret()
      this.webhooks[idx] = {
        ...this.webhooks[idx],
        secret,
        secretRevealed: true,
        updatedAt: new Date().toISOString(),
      }
      return { webhook: { ...this.webhooks[idx], secret: null }, secret }
    }
    if (method === 'POST' && path.startsWith('/api/merchant/webhooks/') && path.endsWith('/test')) {
      const id = path.split('/').pop()!.replace('/test', '')
      const w = this.webhooks.find((x) => x.id === id)
      if (!w) throwObjectNotFound()
      return { dispatched: true, eventId: `evt_${randomId('')}` }
    }
    if (method === 'GET' && path === '/api/merchant/api-keys') {
      return this.apiKeys.map((k) => ({ ...k, secret: null }))
    }
    if (method === 'POST' && path === '/api/merchant/api-keys') {
      const { name } = body as { name: string }
      const key: ApiKey = {
        id: randomId('key'),
        name,
        prefix: 'pk_live_',
        secret: randomSecret(),
        active: true,
        createdAt: new Date().toISOString(),
      }
      this.apiKeys.push(key)
      return { apiKey: { ...key, secret: null }, secret: key.secret }
    }
    if (method === 'PUT' && path.startsWith('/api/merchant/api-keys/')) {
      const id = path.split('/').pop()!
      const idx = this.apiKeys.findIndex((x) => x.id === id)
      if (idx === -1) throwObjectNotFound()
      const { name, active } = body as Partial<ApiKey>
      this.apiKeys[idx] = {
        ...this.apiKeys[idx],
        ...(name !== undefined ? { name } : {}),
        ...(active !== undefined ? { active } : {}),
      }
      return { ...this.apiKeys[idx], secret: null }
    }
    if (method === 'DELETE' && path.startsWith('/api/merchant/api-keys/')) {
      const id = path.split('/').pop()!
      const idx = this.apiKeys.findIndex((x) => x.id === id)
      if (idx === -1) throwObjectNotFound()
      this.apiKeys.splice(idx, 1)
      return { deleted: true }
    }

    throwObjectNotFound()
  }

  /* ------------------------------------------------------------------ */
  /* Merchant API                                                       */
  /* ------------------------------------------------------------------ */

  async getVerificationLevel(): Promise<MerchantVerificationLevel> {
    return this.request('/api/merchant/verification-level', { method: 'GET' })
  }

  async getTierLimits(): Promise<TierLimits> {
    return this.request('/api/merchant/tier-limits', { method: 'GET' })
  }

  async getAddressRateLimit(): Promise<AddressRateLimit> {
    return this.request('/api/merchant/rate-limit', { method: 'GET' })
  }

  async getPayoutSchedule(): Promise<PayoutSchedule> {
    return this.request('/api/merchant/payout-schedule', { method: 'GET' })
  }

  async setPayoutSchedule(schedule: Partial<PayoutSchedule>): Promise<PayoutSchedule> {
    return this.request('/api/merchant/payout-schedule', { method: 'POST', body: schedule })
  }

  async triggerScheduledPayout(): Promise<{ triggered: boolean; scheduledAt: string }> {
    return this.request('/api/merchant/payout-schedule/trigger', { method: 'POST' })
  }

  async listWebhooks(): Promise<Webhook[]> {
    return this.request('/api/merchant/webhooks', { method: 'GET' })
  }

  async getDeliveryLogs(webhookId: string): Promise<WebhookDeliveryLog[]> {
    return this.request(`/api/merchant/webhooks/${webhookId}/logs`, { method: 'GET' })
  }

  async getWebhook(id: string): Promise<Webhook> {
    return this.request(`/api/merchant/webhooks/${id}`, { method: 'GET' })
  }

  async createWebhook(input: {
    url: string
    topics: string[]
    active?: boolean
  }): Promise<{ webhook: Webhook; secret: string }> {
    return this.request('/api/merchant/webhooks', { method: 'POST', body: input })
  }

  async updateWebhook(id: string, input: Partial<Webhook>): Promise<Webhook> {
    return this.request(`/api/merchant/webhooks/${id}`, { method: 'PUT', body: input })
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.request(`/api/merchant/webhooks/${id}`, { method: 'DELETE' })
  }

  async rotateWebhookSecret(id: string): Promise<{ webhook: Webhook; secret: string }> {
    return this.request(`/api/merchant/webhooks/${id}/rotate-secret`, { method: 'POST' })
  }

  async sendTestEvent(id: string): Promise<{ dispatched: boolean; eventId: string }> {
    return this.request(`/api/merchant/webhooks/${id}/test`, { method: 'POST' })
  }

  async listApiKeys(): Promise<ApiKey[]> {
    return this.request('/api/merchant/api-keys', { method: 'GET' })
  }

  async createApiKey(name: string): Promise<{ apiKey: ApiKey; secret: string }> {
    return this.request('/api/merchant/api-keys', { method: 'POST', body: { name } })
  }

  async updateApiKey(id: string, input: Partial<ApiKey>): Promise<ApiKey> {
    return this.request(`/api/merchant/api-keys/${id}`, { method: 'PUT', body: input })
  }

  async deleteApiKey(id: string): Promise<void> {
    await this.request(`/api/merchant/api-keys/${id}`, { method: 'DELETE' })
  }

  getWebhookTopics(): WebhookTopic[] {
    return WEBHOOK_TOPICS
  }
}

function throwObjectNotFound(): never {
  const err = new Error('API error 404: Not Found') as Error & { status?: number; code?: string }
  err.status = 404
  err.code = 'NOT_FOUND'
  throw err
}

function randomSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function generateDeliveryLogs(webhookId: string): WebhookDeliveryLog[] {
  const statuses: WebhookDeliveryLog['status'][] = ['delivered', 'delivered', 'failed', 'pending']
  const topics = WEBHOOK_TOPICS.map((t) => t.value)
  return Array.from({ length: 6 }, (_, i) => {
    const status = statuses[i % statuses.length]
    return {
      id: `log_${webhookId}_${i}`,
      eventId: `evt_${randomId('')}`,
      topic: topics[i % topics.length],
      status,
      httpStatus: status === 'delivered' ? 200 : status === 'failed' ? 502 : undefined,
      attemptedAt: new Date(Date.now() - 86400000 * (5 - i)).toISOString(),
      responseBody: status === 'failed' ? '{"error":"upstream timeout"}' : '{"status":"ok"}',
    }
  })
}

export const merchantApi = new MerchantApi(typeof location !== 'undefined' && location.protocol === 'https:')

