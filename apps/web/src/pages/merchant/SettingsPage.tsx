import { useState } from 'react'
import { VerificationLimitsCard } from '@/components/settings/VerificationLimitsCard'
import { PayoutScheduleCard } from '@/components/settings/PayoutSchedule'
import { WebhookManager } from '@/components/settings/WebhookManager'
import { ApiKeysManager } from '@/components/settings/ApiKeysManager'

type Tab = 'verification' | 'payout' | 'webhooks' | 'api-keys'

const TABS: { id: Tab; label: string }[] = [
  { id: 'verification', label: 'Verification &amp; Limits' },
  { id: 'payout', label: 'Payout Schedule' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'api-keys', label: 'API Keys' },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('verification')

  return (
    <div className="app">
      <h1>Merchant Settings</h1>
      <p className="subtitle">Manage verification tier, payouts, webhooks, and API keys.</p>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'verification' && <VerificationLimitsCard />}
      {activeTab === 'payout' && <PayoutScheduleCard />}
      {activeTab === 'webhooks' && <WebhookManager />}
      {activeTab === 'api-keys' && <ApiKeysManager />}
    </div>
  )
}
