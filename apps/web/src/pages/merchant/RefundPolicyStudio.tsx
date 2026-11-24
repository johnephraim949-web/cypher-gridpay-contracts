import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import PolicyDiffViewer from '../../components/refunds/PolicyDiffViewer';
import PolicyVersionTimeline from '../../components/refunds/PolicyVersionTimeline';

/**
 * RefundPolicyStudio
 *
 * Merchant-facing studio for authoring, previewing, diffing, and committing
 * refund policies on-chain. Also exposes a version timeline so support agents
 * can verify which policy governed a historical payment.
 *
 * NOTE: This component assumes the presence of a contract client abstraction
 * (see `useRefundPolicyClient` below) that wraps the following contract calls:
 *   - get_refund_policy(merchant)
 *   - get_platform_default_refund_policy()
 *   - list_policy_templates()
 *   - set_refund_policy(merchant, policy)
 *   - get_refund_policy_history(merchant)
 *   - get_refund_policy_at_time(merchant, timestamp)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefundPolicy {
  /** Refund window in seconds. Must be > 0. */
  refundWindowSecs: number;
  /** Restocking fee in basis points. Must be within 0..=10000. */
  restockingFeeBps: number;
  /** Cooldown between refund requests in seconds. Must be > 0. */
  cooldownSecs: number;
  /** Whether auto-refund is enabled for eligible payments. */
  autoRefundEnabled: boolean;
  /** Optional max auto-refund amount in the smallest unit. */
  autoRefundMaxAmount?: string;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  policy: RefundPolicy;
}

export interface PolicyVersion {
  version: number;
  policy: RefundPolicy;
  effectiveAt: number; // unix seconds
  txHash?: string;
}

export interface RefundPolicyClient {
  getRefundPolicy(merchant: string): Promise<RefundPolicy>;
  getPlatformDefaultRefundPolicy(): Promise<RefundPolicy>;
  listPolicyTemplates(): Promise<PolicyTemplate[]>;
  setRefundPolicy(merchant: string, policy: RefundPolicy): Promise<{ txHash: string }>;
  getRefundPolicyHistory(merchant: string): Promise<PolicyVersion[]>;
  getRefundPolicyAtTime(merchant: string, timestamp: number): Promise<RefundPolicy>;
}

// ---------------------------------------------------------------------------
// Client hook (placeholder — replace with real contract client wiring)
// ---------------------------------------------------------------------------

function useRefundPolicyClient(): RefundPolicyClient {
  // In production this would be provided via context / DI.
  return useMemo<RefundPolicyClient>(
    () => ({
      async getRefundPolicy() {
        throw new Error('RefundPolicyClient not configured');
      },
      async getPlatformDefaultRefundPolicy() {
        throw new Error('RefundPolicyClient not configured');
      },
      async listPolicyTemplates() {
        throw new Error('RefundPolicyClient not configured');
      },
      async setRefundPolicy() {
        throw new Error('RefundPolicyClient not configured');
      },
      async getRefundPolicyHistory() {
        throw new Error('RefundPolicyClient not configured');
      },
      async getRefundPolicyAtTime() {
        throw new Error('RefundPolicyClient not configured');
      },
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// Validation (mirrors core/contracts/refund bounds)
// ---------------------------------------------------------------------------

export const MAX_FEE_BPS = 10000;

export interface PolicyValidationErrors {
  refundWindowSecs?: string;
  restockingFeeBps?: string;
  cooldownSecs?: string;
  autoRefundMaxAmount?: string;
}

export function validatePolicy(policy: RefundPolicy): PolicyValidationErrors {
  const errors: PolicyValidationErrors = {};

  if (!Number.isFinite(policy.refundWindowSecs) || policy.refundWindowSecs <= 0) {
    errors.refundWindowSecs = 'Refund window must be a non-zero positive duration.';
  }

  if (
    !Number.isFinite(policy.restockingFeeBps) ||
    policy.restockingFeeBps < 0 ||
    policy.restockingFeeBps > MAX_FEE_BPS
  ) {
    errors.restockingFeeBps = `Restocking fee must be between 0 and ${MAX_FEE_BPS} bps.`;
  }

  if (!Number.isFinite(policy.cooldownSecs) || policy.cooldownSecs <= 0) {
    errors.cooldownSecs = 'Cooldown must be a non-zero positive duration.';
  }

  if (policy.autoRefundEnabled && policy.autoRefundMaxAmount !== undefined) {
    const raw = policy.autoRefundMaxAmount.trim();
    if (raw !== '' && !/^\d+$/.test(raw)) {
      errors.autoRefundMaxAmount = 'Auto-refund max amount must be a non-negative integer.';
    }
  }

  return errors;
}

export function hasErrors(errors: PolicyValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

function policiesEqual(a: RefundPolicy | null, b: RefundPolicy | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.refundWindowSecs === b.refundWindowSecs &&
    a.restockingFeeBps === b.restockingFeeBps &&
    a.cooldownSecs === b.cooldownSecs &&
    a.autoRefundEnabled === b.autoRefundEnabled &&
    (a.autoRefundMaxAmount ?? '') === (b.autoRefundMaxAmount ?? '')
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '—';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${secs}s`);
  return parts.join(' ');
}

function formatBps(bps: number): string {
  if (!Number.isFinite(bps)) return '—';
  return `${bps} bps (${(bps / 100).toFixed(2)}%)`;
}

function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  try {
    return new Date(ts * 1000).toISOString();
  } catch {
    return '—';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MERCHANT_ID = 'current-merchant';

export default function RefundPolicyStudio(): JSX.Element {
  const client = useRefundPolicyClient();
  const navigate = useNavigate();

  const [activePolicy, setActivePolicy] = useState<RefundPolicy | null>(null);
  const [platformDefault, setPlatformDefault] = useState<RefundPolicy | null>(null);
  const [templates, setTemplates] = useState<PolicyTemplate[]>([]);
  const [history, setHistory] = useState<PolicyVersion[]>([]);

  const [draft, setDraft] = useState<RefundPolicy | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<PolicyTemplate | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const [historyLookupTs, setHistoryLookupTs] = useState<string>('');
  const [historyLookupResult, setHistoryLookupResult] = useState<RefundPolicy | null>(null);
  const [historyLookupError, setHistoryLookupError] = useState<string | null>(null);
  const [historyLookupLoading, setHistoryLookupLoading] = useState<boolean>(false);

  // Track whether we've already warned to avoid duplicate prompts.
  const bypassGuardRef = useRef<boolean>(false);

  const validationErrors = useMemo(
    () => (draft ? validatePolicy(draft) : {}),
    [draft],
  );
  const draftInvalid = hasErrors(validationErrors);

  const isDirty = useMemo(() => {
    if (!draft) return false;
    return !policiesEqual(draft, activePolicy);
  }, [draft, activePolicy]);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [active, defaults, tmpls, hist] = await Promise.all([
        client.getRefundPolicy(MERCHANT_ID),
        client.getPlatformDefaultRefundPolicy(),
        client.listPolicyTemplates(),
        client.getRefundPolicyHistory(MERCHANT_ID),
      ]);
      setActivePolicy(active);
      setPlatformDefault(defaults);
      setTemplates(tmpls);
      setHistory(hist);
      setDraft(active);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load refund policy data.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // -------------------------------------------------------------------------
  // Navigation guards (beforeunload + router)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isDirty) return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypassGuardRef.current) return;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  // Router navigation guard: intercept in-app navigation while dirty.
  useEffect(() => {
    if (!isDirty) return undefined;

    // react-router v6 does not expose a stable blocking API across versions;
    // we use a capture-phase click listener on anchors as a pragmatic guard.
    const handleClick = (event: MouseEvent) => {
      if (bypassGuardRef.current) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.getAttribute('target') === '_blank') {
        return;
      }
      const confirmed = window.confirm(
        'You have unsaved refund policy changes. Leave without saving?',
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, [isDirty]);

  // -------------------------------------------------------------------------
  // Draft editing
  // -------------------------------------------------------------------------

  const updateDraft = useCallback(<K extends keyof RefundPolicy>(key: K, value: RefundPolicy[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSubmitSuccess(null);
    setSubmitError(null);
  }, []);

  const handleNumberChange = useCallback(
    (key: 'refundWindowSecs' | 'restockingFeeBps' | 'cooldownSecs') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        const parsed = raw === '' ? NaN : Number(raw);
        updateDraft(key, parsed as RefundPolicy[typeof key]);
      },
    [updateDraft],
  );

  const handleResetDraft = useCallback(() => {
    setDraft(activePolicy);
    setPreviewTemplate(null);
    setSubmitError(null);
    setSubmitSuccess(null);
  }, [activePolicy]);

  const handleApplyTemplatePreview = useCallback((template: PolicyTemplate) => {
    setPreviewTemplate(template);
  }, []);

  const handleConfirmApplyTemplate = useCallback(() => {
    if (!previewTemplate) return;
    setDraft({ ...previewTemplate.policy });
    setPreviewTemplate(null);
    setSubmitSuccess(null);
    setSubmitError(null);
  }, [previewTemplate]);

  const handleCancelTemplatePreview = useCallback(() => {
    setPreviewTemplate(null);
  }, []);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!draft) return;
    if (draftInvalid) {
      setSubmitError('Please fix validation errors before submitting.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const result = await client.setRefundPolicy(MERCHANT_ID, draft);
      setSubmitSuccess(`Policy updated on-chain (tx: ${result.txHash}).`);
      // Refresh data after successful commit.
      const [active, hist] = await Promise.all([
        client.getRefundPolicy(MERCHANT_ID),
        client.getRefundPolicyHistory(MERCHANT_ID),
      ]);
      setActivePolicy(active);
      setHistory(hist);
      setDraft(active);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit refund policy.');
    } finally {
      setSubmitting(false);
    }
  }, [client, draft, draftInvalid]);

  // -------------------------------------------------------------------------
  // Historical lookup
  // -------------------------------------------------------------------------

  const handleHistoryLookup = useCallback(async () => {
    setHistoryLookupError(null);
    setHistoryLookupResult(null);
    const raw = historyLookupTs.trim();
    if (!raw) {
      setHistoryLookupError('Enter a timestamp (unix seconds) to look up.');
      return;
    }
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) {
      setHistoryLookupError('Timestamp must be a positive unix seconds value.');
      return;
    }
    setHistoryLookupLoading(true);
    try {
      const policy = await client.getRefundPolicyAtTime(MERCHANT_ID, ts);
      setHistoryLookupResult(policy);
    } catch (err) {
      setHistoryLookupError(
        err instanceof Error ? err.message : 'Failed to fetch policy at time.',
      );
    } finally {
      setHistoryLookupLoading(false);
    }
  }, [client, historyLookupTs]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="refund-policy-studio" data-testid="refund-policy-studio-loading">
        <p>Loading refund policy studio…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="refund-policy-studio" data-testid="refund-policy-studio-error">
        <div role="alert" className="error-banner">
          {loadError}
        </div>
        <button type="button" onClick={() => void loadAll()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="refund-policy-studio" data-testid="refund-policy-studio">
      <header className="refund-policy-studio__header">
        <h1>Refund Policy Studio</h1>
        <p className="refund-policy-studio__subtitle">
          Author, preview, and commit your merchant refund policy on-chain.
        </p>
      </header>

      {/* Prospective-change warning banner */}
      <div
        role="note"
        className="warning-banner"
        data-testid="prospective-change-warning"
      >
        <strong>Heads up:</strong> Policy changes apply <em>prospectively</em> only.
        Historical payments remain governed by the policy that was in effect at
        the time of payment (see <code>get_refund_policy_at_time</code>).
      </div>

      {/* Active policy summary */}
      <section className="refund-policy-studio__section" aria-labelledby="active-policy-heading">
        <h2 id="active-policy-heading">Active Policy</h2>
        {activePolicy ? (
          <dl className="policy-summary" data-testid="active-policy-summary">
            <dt>Refund window</dt>
            <dd>{formatDuration(activePolicy.refundWindowSecs)}</dd>
            <dt>Restocking fee</dt>
            <dd>{formatBps(activePolicy.restockingFeeBps)}</dd>
            <dt>Cooldown</dt>
            <dd>{formatDuration(activePolicy.cooldownSecs)}</dd>
            <dt>Auto-refund</dt>
            <dd>{activePolicy.autoRefundEnabled ? 'Enabled' : 'Disabled'}</dd>
            {activePolicy.autoRefundEnabled && activePolicy.autoRefundMaxAmount ? (
              <>
                <dt>Auto-refund max</dt>
                <dd>{activePolicy.autoRefundMaxAmount}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p>No active policy found.</p>
        )}
        {platformDefault ? (
          <details className="platform-default" data-testid="platform-default-policy">
            <summary>Compare with platform default</summary>
            <dl className="policy-summary">
              <dt>Refund window</dt>
              <dd>{formatDuration(platformDefault.refundWindowSecs)}</dd>
              <dt>Restocking fee</dt>
              <dd>{formatBps(platformDefault.restockingFeeBps)}</dd>
              <dt>Cooldown</dt>
              <dd>{formatDuration(platformDefault.cooldownSecs)}</dd>
              <dt>Auto-refund</dt>
              <dd>{platformDefault.autoRefundEnabled ? 'Enabled' : 'Disabled'}</dd>
            </dl>
          </details>
        ) : null}
      </section>

      {/* Template gallery */}
      <section className="refund-policy-studio__section" aria-labelledby="templates-heading">
        <h2 id="templates-heading">Policy Template Gallery</h2>
        {templates.length === 0 ? (
          <p>No templates available.</p>
        ) : (
          <ul className="template-gallery" data-testid="template-gallery">
            {templates.map((template) => (
              <li key={template.id} className="template-card" data-testid={`template-${template.id}`}>
                <h3>{template.name}</h3>
                <p>{template.description}</p>
                <dl className="policy-summary">
                  <dt>Refund window</dt>
                  <dd>{formatDuration(template.policy.refundWindowSecs)}</dd>
                  <dt>Restocking fee</dt>
                  <dd>{formatBps(template.policy.restockingFeeBps)}</dd>
                  <dt>Cooldown</dt>
                  <dd>{formatDuration(template.policy.cooldownSecs)}</dd>
                  <dt>Auto-refund</dt>
                  <dd>{template.policy.autoRefundEnabled ? 'Enabled' : 'Disabled'}</dd>
                </dl>
                <button
                  type="button"
                  onClick={() => handleApplyTemplatePreview(template)}
                  data-testid={`apply-template-${template.id}`}
                >
                  Apply Template
                </button>
              </li>
            ))}
          </ul>
        )}

        {previewTemplate ? (
          <div className="template-preview" role="dialog" aria-modal="true" data-testid="template-preview">
            <h3>Preview: {previewTemplate.name}</h3>
            <p>This will replace your current draft with the template values.</p>
            <PolicyDiffViewer
              current={draft}
              proposed={previewTemplate.policy}
              title="Template Preview Diff"
            />
            <div className="template-preview__actions">
              <button type="button" onClick={handleConfirmApplyTemplate} data-testid="confirm-apply-template">
                Apply to Draft
              </button>
              <button type="button" onClick={handleCancelTemplatePreview} data-testid="cancel-apply-template">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Draft editor */}
      <section className="refund-policy-studio__section" aria-labelledby="draft-heading">
        <h2 id="draft-heading">Draft Policy</h2>
        {draft ? (
          <form
            className="policy-draft-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            data-testid="policy-draft-form"
          >
            <div className="form-field">
              <label htmlFor="refundWindowSecs">Refund window (seconds)</label>
              <input
                id="refundWindowSecs"
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(draft.refundWindowSecs) ? draft.refundWindowSecs : ''}
                onChange={handleNumberChange('refundWindowSecs')}
                aria-invalid={Boolean(validationErrors.refundWindowSecs)}
                aria-describedby={
                  validationErrors.refundWindowSecs ? 'refundWindowSecs-error' : undefined
                }
              />
              {validationErrors.refundWindowSecs ? (
                <p id="refundWindowSecs-error" className="field-error" role="alert">
                  {validationErrors.refundWindowSecs}
                </p>
              ) : null}
            </div>

            <div className="form-field">
              <label htmlFor="restockingFeeBps">Restocking fee (basis points)</label>
              <input
                id="restockingFeeBps"
                type="number"
                min={0}
                max={MAX_FEE_BPS}
                step={1}
                value={Number.isFinite(draft.restockingFeeBps) ? draft.restockingFeeBps : ''}
                onChange={handleNumberChange('restockingFeeBps')}
                aria-invalid={Boolean(validationErrors.restockingFeeBps)}
                aria-describedby={
                  validationErrors.restockingFeeBps ? 'restockingFeeBps-error' : undefined
                }
              />
              {validationErrors.restockingFeeBps ? (
                <p id="restockingFeeBps-error" className="field-error" role="alert">
                  {validationErrors.restockingFeeBps}
                </p>
              ) : null}
            </div>

            <div className="form-field">
              <label htmlFor="cooldownSecs">Cooldown (seconds)</label>
              <input
                id="cooldownSecs"
                type="number"
                min={1}
                step={1}
                value={Number.isFinite(draft.cooldownSecs) ? draft.cooldownSecs : ''}
                onChange={handleNumberChange('cooldownSecs')}
                aria-invalid={Boolean(validationErrors.cooldownSecs)}
                aria-describedby={
                  validationErrors.cooldownSecs ? 'cooldownSecs-error' : undefined
                }
              />
              {validationErrors.cooldownSecs ? (
                <p id="cooldownSecs-error" className="field-error" role="alert">
                  {validationErrors.cooldownSecs}
                </p>
              ) : null}
            </div>

            <div className="form-field form-field--checkbox">
              <label htmlFor="autoRefundEnabled">
                <input
                  id="autoRefundEnabled"
                  type="checkbox"
                  checked={draft.autoRefundEnabled}
                  onChange={(event) => updateDraft('autoRefundEnabled', event.target.checked)}
                />
                Enable auto-refund for eligible payments
              </label>
            </div>

            {draft.autoRefundEnabled ? (
              <div className="form-field">
                <label htmlFor="autoRefundMaxAmount">Auto-refund max amount (optional)</label>
                <input
                  id="autoRefundMaxAmount"
                  type="text"
                  inputMode="numeric"
                  value={draft.autoRefundMaxAmount ?? ''}
                  onChange={(event) => updateDraft('autoRefundMaxAmount', event.target.value)}
                  aria-invalid={Boolean(validationErrors.autoRefundMaxAmount)}
                  aria-describedby={
                    validationErrors.autoRefundMaxAmount ? 'autoRefundMaxAmount-error' : undefined
                  }
                />
                {validationErrors.autoRefundMaxAmount ? (
                  <p id="autoRefundMaxAmount-error" className="field-error" role="alert">
                    {validationErrors.autoRefundMaxAmount}
                  </p>
                ) : null}
              </div>
            ) : null}

            {submitError ? (
              <div role="alert" className="error-banner" data-testid="submit-error">
                {submitError}
              </div>
            ) : null}
            {submitSuccess ? (
              <div role="status" className="success-banner" data-testid="submit-success">
                {submitSuccess}
              </div>
            ) : null}

            <div className="policy-draft-form__actions">
              <button
                type="submit"
                disabled={submitting || draftInvalid || !isDirty}
                data-testid="submit-policy"
              >
                {submitting ? 'Submitting…' : 'Sign & Commit Policy'}
              </button>
              <button
                type="button"
                onClick={handleResetDraft}
                disabled={submitting || !isDirty}
                data-testid="reset-draft"
              >
                Reset Draft
              </button>
            </div>
          </form>
        ) : (
          <p>No draft available.</p>
        )}
      </section>

      {/* Diff viewer */}
      <section className="refund-policy-studio__section" aria-labelledby="diff-heading">
        <h2 id="diff-heading">Policy Diff</h2>
        <PolicyDiffViewer
          current={activePolicy}
          proposed={draft}
          title="Current vs. Proposed"
        />
      </section>

      {/* Version timeline */}
      <section className="refund-policy-studio__section" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">Policy Version Timeline</h2>
        <PolicyVersionTimeline versions={history} />

        <div className="history-lookup" data-testid="history-lookup">
          <h3>Look up policy at a historical time</h3>
          <p>
            Support agents can verify which policy governed an older payment by
            querying <code>get_refund_policy_at_time</code>.
          </p>
          <div className="history-lookup__controls">
            <label htmlFor="historyLookupTs">Unix timestamp (seconds)</label>
            <input
              id="historyLookupTs"
              type="text"
              inputMode="numeric"
              value={historyLookupTs}
              onChange={(event) => setHistoryLookupTs(event.target.value)}
            />
            <button
              type="button"
              onClick={() => void handleHistoryLookup()}
              disabled={historyLookupLoading}
              data-testid="history-lookup-button"
            >
              {historyLookupLoading ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          {historyLookupError ? (
            <div role="alert" className="error-banner" data-testid="history-lookup-error">
              {historyLookupError}
            </div>
          ) : null}
          {historyLookupResult ? (
            <dl className="policy-summary" data-testid="history-lookup-result">
              <dt>Refund window</dt>
              <dd>{formatDuration(historyLookupResult.refundWindowSecs)}</dd>
              <dt>Restocking fee</dt>
              <dd>{formatBps(historyLookupResult.restockingFeeBps)}</dd>
              <dt>Cooldown</dt>
              <dd>{formatDuration(historyLookupResult.cooldownSecs)}</dd>
              <dt>Auto-refund</dt>
              <dd>{historyLookupResult.autoRefundEnabled ? 'Enabled' : 'Disabled'}</dd>
            </dl>
          ) : null}
        </div>
      </section>
    </div>
  );
}