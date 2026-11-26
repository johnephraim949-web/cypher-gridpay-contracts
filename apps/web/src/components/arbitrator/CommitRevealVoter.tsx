import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Phase = 'commit' | 'reveal' | 'finalized';

type EvidenceSide = {
  title: string;
  party: string;
  policyVersion: string;
  items: { label: string; detail: string }[];
};

export type CommitRevealVoterProps = {
  disputeId: string;
  customerEvidence: EvidenceSide;
  merchantEvidence: EvidenceSide;
  commitDeadline: number;
  revealDeadline: number;
  onCommit?: (payload: { commitment: string; salt: string }) => Promise<void> | void;
  onReveal?: (payload: { vote: 'customer' | 'merchant'; salt: string }) => Promise<void> | void;
  onRecuse?: () => Promise<void> | void;
};

const KEYFILE_STORE = 'arbitrator-reveal-keys';

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function toIcsDate(ts: number): string {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildRevealReminderIcs(disputeId: string, revealOpensAt: number): string {
  const start = toIcsDate(revealOpensAt);
  const end = toIcsDate(revealOpensAt + 15 * 60 * 1000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Handsoff//Arbitrator Reveal Reminder//EN',
    'BEGIN:VEVENT',
    `UID:reveal-${disputeId}@handsoff`,
    `DTSTAMP:${toIcsDate(Date.now())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:Reveal your blind vote — dispute ${disputeId}`,
    'DESCRIPTION:Reveal phase is open. Return with your Reveal Keyfile to reveal your committed vote or risk stake slashing.',
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reveal window opens soon',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openKeyfileDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    const req = indexedDB.open(KEYFILE_STORE, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function storeKeyfile(disputeId: string, keyfile: string): Promise<void> {
  const db = await openKeyfileDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(keyfile, disputeId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function loadKeyfile(disputeId: string): Promise<string | null> {
  const db = await openKeyfileDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction('keys', 'readonly');
    const req = tx.objectStore('keys').get(disputeId);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => resolve(null);
  });
}

function PhaseProgress({ phase }: { phase: Phase }) {
  const steps: { key: Phase; label: string }[] = [
    { key: 'commit', label: 'Phase 1: Blind Commit' },
    { key: 'reveal', label: 'Phase 2: Reveal Vote' },
    { key: 'finalized', label: 'Consensus Finalized' },
  ];
  const activeIndex = steps.findIndex((s) => s.key === phase);
  return (
    <ol className="crv-progress" aria-label="Voting progress">
      {steps.map((step, i) => (
        <li
          key={step.key}
          className={`crv-progress-step ${i === activeIndex ? 'is-active' : ''} ${i < activeIndex ? 'is-done' : ''}`}
          aria-current={i === activeIndex ? 'step' : undefined}
        >
          <span className="crv-progress-dot">{i < activeIndex ? '✓' : i + 1}</span>
          <span className="crv-progress-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Countdown({ label, deadline }: { label: string; deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = deadline - now;
  return (
    <div className={`crv-countdown ${remaining <= 0 ? 'is-expired' : ''}`}>
      <span className="crv-countdown-label">{label}</span>
      <span className="crv-countdown-clock" role="timer">
        {remaining <= 0 ? 'Window closed' : formatCountdown(remaining)}
      </span>
    </div>
  );
}

export function CommitRevealVoter({
  disputeId,
  customerEvidence,
  merchantEvidence,
  commitDeadline,
  revealDeadline,
  onCommit,
  onReveal,
  onRecuse,
}: CommitRevealVoterProps) {
  const [phase, setPhase] = useState<Phase>('commit');
  const [vote, setVote] = useState<'customer' | 'merchant' | null>(null);
  const [conflictChecked, setConflictChecked] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [keyfileReady, setKeyfileReady] = useState(false);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState<string | null>(null);
  const [salt, setSalt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadKeyfile(disputeId).then((stored) => {
      if (!cancelled && stored) setKeyfileReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [disputeId]);

  const revealOpensAt = commitDeadline;
  const canCommit = conflictChecked && riskAcknowledged && vote !== null && !busy;
  const canReveal = keyfileReady && salt !== null && vote !== null && !busy;

  const handleDownloadKeyfile = useCallback(async () => {
    const newSalt = salt ?? randomHex(32);
    const passphrase = recoveryPassphrase ?? randomHex(16);
    setSalt(newSalt);
    setRecoveryPassphrase(passphrase);
    const keyfile = JSON.stringify(
      { disputeId, salt: newSalt, recoveryPassphrase: passphrase, createdAt: new Date().toISOString() },
      null,
      2,
    );
    await storeKeyfile(disputeId, keyfile);
    setKeyfileReady(true);
    downloadFile(`reveal-keyfile-${disputeId}.json`, keyfile, 'application/json');
  }, [disputeId, salt, recoveryPassphrase]);

  const handleUploadKeyfile = useCallback(
    async (file: File) => {
      const text = await file.text();
      try {
        const parsed = JSON.parse(text) as { salt?: string; recoveryPassphrase?: string };
        if (parsed.salt) {
          setSalt(parsed.salt);
          setRecoveryPassphrase(parsed.recoveryPassphrase ?? null);
          await storeKeyfile(disputeId, text);
          setKeyfileReady(true);
        }
      } catch {
        setKeyfileReady(false);
      }
    },
    [disputeId],
  );

  const handleCommit = useCallback(async () => {
    if (!canCommit || vote === null) return;
    setBusy(true);
    try {
      const commitSalt = salt ?? randomHex(32);
      setSalt(commitSalt);
      const commitment = `${vote}:${commitSalt}`;
      await onCommit?.({ commitment, salt: commitSalt });
      setPhase('reveal');
    } finally {
      setBusy(false);
    }
  }, [canCommit, vote, salt, onCommit]);

  const handleReveal = useCallback(async () => {
    if (!canReveal || vote === null || salt === null) return;
    setBusy(true);
    try {
      await onReveal?.({ vote, salt });
      setPhase('finalized');
    } finally {
      setBusy(false);
    }
  }, [canReveal, vote, salt, onReveal]);

  const handleRecuse = useCallback(async () => {
    setBusy(true);
    try {
      await onRecuse?.();
    } finally {
      setBusy(false);
    }
  }, [onRecuse]);

  const handleCalendarExport = useCallback(() => {
    downloadFile(`reveal-reminder-${disputeId}.ics`, buildRevealReminderIcs(disputeId, revealOpensAt), 'text/calendar');
  }, [disputeId, revealOpensAt]);

  const qrPayload = useMemo(
    () => (recoveryPassphrase ? `handsoff://reveal/${disputeId}?pass=${recoveryPassphrase}` : ''),
    [disputeId, recoveryPassphrase],
  );

  return (
    <section className="crv-root" aria-label="Arbitrator commit-reveal voting">
      <header className="crv-header">
        <h2>Blind Voting — Dispute {disputeId}</h2>
        <PhaseProgress phase={phase} />
        <div className="crv-countdowns">
          {phase === 'commit' && <Countdown label="Commit window closes in" deadline={commitDeadline} />}
          {phase === 'reveal' && <Countdown label="Reveal window closes in" deadline={revealDeadline} />}
        </div>
      </header>

      <div className="crv-split-view">
        <article className="crv-evidence-pane" aria-label="Customer claim and evidence">
          <h3>{customerEvidence.title}</h3>
          <p className="crv-party">{customerEvidence.party}</p>
          <ul>
            {customerEvidence.items.map((item) => (
              <li key={item.label}>
                <strong>{item.label}:</strong> {item.detail}
              </li>
            ))}
          </ul>
        </article>
        <article className="crv-evidence-pane" aria-label="Merchant counter-evidence and policy version">
          <h3>{merchantEvidence.title}</h3>
          <p className="crv-party">{merchantEvidence.party}</p>
          <p className="crv-policy-version">Policy version: {merchantEvidence.policyVersion}</p>
          <ul>
            {merchantEvidence.items.map((item) => (
              <li key={item.label}>
                <strong>{item.label}:</strong> {item.detail}
              </li>
            ))}
          </ul>
        </article>
      </div>

      <div className="crv-conflict-check">
        <label>
          <input
            type="checkbox"
            checked={conflictChecked}
            onChange={(e) => setConflictChecked(e.target.checked)}
          />
          I have reviewed both parties and confirm I have no conflict of interest.
        </label>
        <button type="button" className="crv-recuse" onClick={handleRecuse} disabled={busy}>
          Recuse Myself
        </button>
      </div>

      {phase === 'commit' && (
        <div className="crv-vote-selection">
          <button
            type="button"
            className={vote === 'customer' ? 'is-selected' : ''}
            onClick={() => setVote('customer')}
          >
            Favor Customer
          </button>
          <button
            type="button"
            className={vote === 'merchant' ? 'is-selected' : ''}
            onClick={() => setVote('merchant')}
          >
            Favor Merchant
          </button>
        </div>
      )}

      {phase === 'commit' && (
        <div className="crv-salt-checkpoint" role="region" aria-label="Salt backup checkpoint">
          <h3>⚠ Salt Backup Checkpoint</h3>
          <p>
            Your secret salt is required to reveal your vote. If you lose it, you cannot reveal and your stake may be
            slashed.
          </p>
          <div className="crv-salt-actions">
            <button type="button" onClick={handleDownloadKeyfile}>
              Download Reveal Keyfile (.json)
            </button>
            <button type="button" onClick={handleCalendarExport}>
              Add Reveal Reminder (.ics)
            </button>
          </div>
          {recoveryPassphrase && (
            <div className="crv-recovery">
              <p>Recovery passphrase (store offline):</p>
              <code className="crv-passphrase">{recoveryPassphrase}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(recoveryPassphrase)}
              >
                Copy passphrase
              </button>
              {qrPayload && (
                <p className="crv-qr" aria-label="Recovery QR payload">
                  QR: <code>{qrPayload}</code>
                </p>
              )}
            </div>
          )}
          <p className={`crv-keyfile-status ${keyfileReady ? 'is-ready' : 'is-missing'}`}>
            {keyfileReady ? 'Reveal key ready on this device' : 'No reveal key stored on this device yet'}
          </p>
          <label className="crv-risk-ack">
            <input
              type="checkbox"
              checked={riskAcknowledged}
              onChange={(e) => setRiskAcknowledged(e.target.checked)}
            />
            I understand that failing to reveal during the reveal window may result in stake slashing.
          </label>
          <button type="button" className="crv-commit" onClick={handleCommit} disabled={!canCommit}>
            {busy ? 'Committing…' : 'Submit Blind Commit'}
          </button>
        </div>
      )}

      {phase === 'reveal' && (
        <div className="crv-reveal-panel" role="region" aria-label="Reveal vote">
          <h3>Phase 2: Reveal Vote</h3>
          <p>Committing alone does not finish your duty — you must return here to reveal.</p>
          <p className={`crv-keyfile-status ${keyfileReady ? 'is-ready' : 'is-missing'}`}>
            {keyfileReady
              ? 'Reveal key ready on this device'
              : 'Upload your saved Reveal Keyfile to unlock Reveal button'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUploadKeyfile(file);
            }}
          />
          <div className="crv-reveal-actions">
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Upload Reveal Keyfile
            </button>
            <button type="button" onClick={handleCalendarExport}>
              Add Reveal Reminder (.ics)
            </button>
            <button type="button" className="crv-reveal" onClick={handleReveal} disabled={!canReveal}>
              {busy ? 'Revealing…' : 'Reveal My Vote'}
            </button>
          </div>
        </div>
      )}

      {phase === 'finalized' && (
        <div className="crv-finalized" role="status">
          <h3>Consensus Finalized</h3>
          <p>Your vote has been revealed and counted.</p>
        </div>
      )}
    </section>
  );
}

export default CommitRevealVoter;
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeVoteCommitment,
  generateSalt,
  encryptRevealBackup,
  decryptRevealBackup,
  downloadRevealBackup,
  storeEncryptedReveal,
  loadEncryptedReveal,
  type RevealBackup,
  type VoteChoice,
} from "../../utils/commitRevealCrypto";

/**
 * CommitRevealVoter
 *
 * Implements the two-phase commit-reveal blind voting flow for arbitrators.
 *
 * Phase 1 (Commit):
 *   - Generate a cryptographically random 32-byte salt via crypto.getRandomValues
 *   - Compute the XDR-compatible SHA-256 commitment matching the Soroban contract
 *   - Prompt the arbitrator to export/encrypt a local reveal backup
 *   - Submit the commit transaction
 *
 * Phase 2 (Reveal):
 *   - Alert when the reveal window opens
 *   - Block reveal submissions before the commit phase closes or after the reveal deadline
 *
 * Security invariants:
 *   - Reveal salts are stored encrypted in IndexedDB (keyed via wallet signature derivation)
 *   - A downloadable JSON recovery file is offered
 *   - Losing the salt before reveal causes slashing
 *   - Only active panel members may vote; others see a read-only view
 */

export interface ArbitrationPanelMember {
  address: string;
  role?: string;
}

export interface CommitRevealVoterProps {
  /** The case being arbitrated. */
  caseId: string;
  /** Connected wallet address. */
  walletAddress: string | null;
  /** Panel members returned by get_arbitration_panel(case_id). */
  panel: ArbitrationPanelMember[];
  /** Unix timestamp (seconds) when the commit phase closes. */
  commitDeadline: number;
  /** Unix timestamp (seconds) when the reveal phase opens. */
  revealStart: number;
  /** Unix timestamp (seconds) when the reveal phase closes. */
  revealDeadline: number;
  /** Existing committed vote, if any (from contract state). */
  existingCommitment?: string | null;
  /** Whether the arbitrator has already revealed. */
  hasRevealed?: boolean;
  /** Function to derive the encryption key from a wallet signature. */
  deriveEncryptionKey: (walletAddress: string) => Promise<CryptoKey>;
  /** Submits the commit transaction. Returns the tx hash. */
  onSubmitCommit: (params: {
    caseId: string;
    commitment: string;
  }) => Promise<string>;
  /** Submits the reveal transaction. Returns the tx hash. */
  onSubmitReveal: (params: {
    caseId: string;
    choice: VoteChoice;
    salt: string;
  }) => Promise<string>;
  /** Optional callback when a vote is committed. */
  onCommitted?: (txHash: string) => void;
  /** Optional callback when a vote is revealed. */
  onRevealed?: (txHash: string) => void;
}

type Phase = "commit" | "awaiting-reveal" | "reveal" | "closed";

const VOTE_CHOICES: { value: VoteChoice; label: string }[] = [
  { value: "refund", label: "Refund Claimant" },
  { value: "deny", label: "Deny Claim" },
  { value: "split", label: "Split" },
];

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function formatCountdown(targetSeconds: number): string {
  const diff = targetSeconds - nowSeconds();
  if (diff <= 0) return "expired";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function normalizeAddress(addr: string | null | undefined): string {
  return (addr ?? "").trim().toUpperCase();
}

export const CommitRevealVoter: React.FC<CommitRevealVoterProps> = ({
  caseId,
  walletAddress,
  panel,
  commitDeadline,
  revealStart,
  revealDeadline,
  existingCommitment,
  hasRevealed = false,
  deriveEncryptionKey,
  onSubmitCommit,
  onSubmitReveal,
  onCommitted,
  onRevealed,
}) => {
  const [tick, setTick] = useState<number>(nowSeconds());
  const [choice, setChoice] = useState<VoteChoice>("refund");
  const [salt, setSalt] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(
    existingCommitment ?? null
  );
  const [backupExported, setBackupExported] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [revealAlertShown, setRevealAlertShown] = useState<boolean>(false);
  const [loadedFromStorage, setLoadedFromStorage] = useState<boolean>(false);

  const encryptionKeyRef = useRef<CryptoKey | null>(null);

  // Tick every second for countdowns / phase transitions.
  useEffect(() => {
    const id = window.setInterval(() => setTick(nowSeconds()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const isPanelist = useMemo(() => {
    if (!walletAddress) return false;
    const target = normalizeAddress(walletAddress);
    return panel.some((m) => normalizeAddress(m.address) === target);
  }, [panel, walletAddress]);

  const phase: Phase = useMemo(() => {
    if (tick < commitDeadline) return "commit";
    if (tick < revealStart) return "awaiting-reveal";
    if (tick < revealDeadline) return "reveal";
    return "closed";
  }, [tick, commitDeadline, revealStart, revealDeadline]);

  const commitPhaseOpen = phase === "commit";
  const revealPhaseOpen = phase === "reveal";

  // Alert when the reveal window opens.
  useEffect(() => {
    if (
      phase === "reveal" &&
      !revealAlertShown &&
      commitment &&
      !hasRevealed
    ) {
      setRevealAlertShown(true);
      setStatus(
        "The reveal window is now open. Reveal your vote before the deadline."
      );
    }
  }, [phase, revealAlertShown, commitment, hasRevealed]);

  // Attempt to load a previously stored encrypted reveal backup.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!walletAddress || !isPanelist || loadedFromStorage) return;
      try {
        const stored = await loadEncryptedReveal(caseId, walletAddress);
        if (!stored || cancelled) return;
        if (!encryptionKeyRef.current) {
          encryptionKeyRef.current = await deriveEncryptionKey(walletAddress);
        }
        const backup = await decryptRevealBackup(
          stored,
          encryptionKeyRef.current
        );
        if (cancelled) return;
        setSalt(backup.salt);
        setChoice(backup.choice);
        setCommitment(backup.commitment);
        setBackupExported(true);
        setLoadedFromStorage(true);
      } catch {
        // No stored backup or unable to decrypt; ignore silently.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    caseId,
    walletAddress,
    isPanelist,
    loadedFromStorage,
    deriveEncryptionKey,
  ]);

  const ensureEncryptionKey = useCallback(async (): Promise<CryptoKey> => {
    if (encryptionKeyRef.current) return encryptionKeyRef.current;
    if (!walletAddress) throw new Error("Wallet not connected");
    const key = await deriveEncryptionKey(walletAddress);
    encryptionKeyRef.current = key;
    return key;
  }, [walletAddress, deriveEncryptionKey]);

  const handleGenerateCommitment = useCallback(async () => {
    setError(null);
    setStatus(null);
    try {
      const newSalt = generateSalt();
      const newCommitment = await computeVoteCommitment({
        caseId,
        choice,
        salt: newSalt,
      });
      setSalt(newSalt);
      setCommitment(newCommitment);
      setBackupExported(false);
      setStatus(
        "Commitment generated. Export your encrypted reveal backup before committing — losing the salt causes slashing."
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to generate commitment"
      );
    }
  }, [caseId, choice]);

  const handleExportBackup = useCallback(async () => {
    setError(null);
    if (!salt || !commitment) {
      setError("Generate a commitment before exporting a backup.");
      return;
    }
    if (!walletAddress) {
      setError("Wallet not connected.");
      return;
    }
    try {
      const key = await ensureEncryptionKey();
      const backup: RevealBackup = {
        version: 1,
        caseId,
        walletAddress,
        choice,
        salt,
        commitment,
        createdAt: new Date().toISOString(),
      };
      const encrypted = await encryptRevealBackup(backup, key);
      await storeEncryptedReveal(caseId, walletAddress, encrypted);
      downloadRevealBackup(caseId, encrypted);
      setBackupExported(true);
      setStatus(
        "Encrypted reveal backup exported and stored locally. Keep it safe."
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to export reveal backup"
      );
    }
  }, [salt, commitment, walletAddress, caseId, choice, ensureEncryptionKey]);

  const handleCommit = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!isPanelist) {
      setError("Connected wallet is not an active panel member.");
      return;
    }
    if (!commitPhaseOpen) {
      setError("The commit phase is closed.");
      return;
    }
    if (!salt || !commitment) {
      setError("Generate a commitment first.");
      return;
    }
    if (!backupExported) {
      setError(
        "Export your encrypted reveal backup before committing. Losing the salt causes slashing."
      );
      return;
    }
    setBusy(true);
    try {
      const txHash = await onSubmitCommit({ caseId, commitment });
      setStatus(`Commit submitted: ${txHash}`);
      onCommitted?.(txHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit transaction failed");
    } finally {
      setBusy(false);
    }
  }, [
    isPanelist,
    commitPhaseOpen,
    salt,
    commitment,
    backupExported,
    onSubmitCommit,
    caseId,
    onCommitted,
  ]);

  const handleReveal = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (!isPanelist) {
      setError("Connected wallet is not an active panel member.");
      return;
    }
    if (phase === "commit" || phase === "awaiting-reveal") {
      setError("The commit phase has not closed yet. Reveal is not allowed.");
      return;
    }
    if (phase === "closed" || tick >= revealDeadline) {
      setError("The reveal deadline has passed. Reveal is no longer allowed.");
      return;
    }
    if (!revealPhaseOpen) {
      setError("The reveal window is not open.");
      return;
    }
    if (!salt || !commitment) {
      setError(
        "No reveal salt available. Import your encrypted backup to reveal."
      );
      return;
    }
    setBusy(true);
    try {
      const txHash = await onSubmitReveal({ caseId, choice, salt });
      setStatus(`Reveal submitted: ${txHash}`);
      onRevealed?.(txHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reveal transaction failed");
    } finally {
      setBusy(false);
    }
  }, [
    isPanelist,
    phase,
    tick,
    revealDeadline,
    revealPhaseOpen,
    salt,
    commitment,
    onSubmitReveal,
    caseId,
    choice,
    onRevealed,
  ]);

  const handleImportBackup = useCallback(
    async (file: File) => {
      setError(null);
      setStatus(null);
      if (!walletAddress) {
        setError("Wallet not connected.");
        return;
      }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const key = await ensureEncryptionKey();
        const backup = await decryptRevealBackup(parsed, key);
        if (backup.caseId !== caseId) {
          setError("Backup belongs to a different case.");
          return;
        }
        if (normalizeAddress(backup.walletAddress) !== normalizeAddress(walletAddress)) {
          setError("Backup belongs to a different wallet.");
          return;
        }
        setSalt(backup.salt);
        setChoice(backup.choice);
        setCommitment(backup.commitment);
        setBackupExported(true);
        setStatus("Reveal backup imported successfully.");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to import reveal backup"
        );
      }
    },
    [walletAddress, caseId, ensureEncryptionKey]
  );

  const phaseLabel = useMemo(() => {
    switch (phase) {
      case "commit":
        return `Commit phase — closes in ${formatCountdown(commitDeadline)}`;
      case "awaiting-reveal":
        return `Commit closed — reveal opens in ${formatCountdown(revealStart)}`;
      case "reveal":
        return `Reveal phase — closes in ${formatCountdown(revealDeadline)}`;
      case "closed":
        return "Voting closed";
      default:
        return "";
    }
  }, [phase, commitDeadline, revealStart, revealDeadline]);

  // Read-only view for non-panelists.
  if (!isPanelist) {
    return (
      <section
        className="commit-reveal-voter commit-reveal-voter--readonly"
        aria-label="Commit-reveal voting (read-only)"
        data-testid="commit-reveal-voter-readonly"
      >
        <header className="commit-reveal-voter__header">
          <h3>Commit-Reveal Voting</h3>
          <span className="commit-reveal-voter__badge">Read-only</span>
        </header>
        <p className="commit-reveal-voter__notice">
          Your connected wallet is not an active member of the arbitration
          panel for this case. Voting controls are disabled.
        </p>
        <dl className="commit-reveal-voter__meta">
          <dt>Case</dt>
          <dd>{caseId}</dd>
          <dt>Phase</dt>
          <dd>{phaseLabel}</dd>
          <dt>Commitment</dt>
          <dd>{existingCommitment ?? "—"}</dd>
        </dl>
      </section>
    );
  }

  return (
    <section
      className="commit-reveal-voter"
      aria-label="Commit-reveal voting"
      data-testid="commit-reveal-voter"
    >
      <header className="commit-reveal-voter__header">
        <h3>Commit-Reveal Voting</h3>
        <span
          className={`commit-reveal-voter__phase commit-reveal-voter__phase--${phase}`}
        >
          {phaseLabel}
        </span>
      </header>

      {status && (
        <div className="commit-reveal-voter__status" role="status">
          {status}
        </div>
      )}
      {error && (
        <div className="commit-reveal-voter__error" role="alert">
          {error}
        </div>
      )}

      {/* Phase 1: Commit */}
      <fieldset
        className="commit-reveal-voter__phase-block"
        disabled={!commitPhaseOpen || busy || !!existingCommitment}
      >
        <legend>Phase 1 — Commit</legend>

        <label className="commit-reveal-voter__field">
          <span>Vote choice</span>
          <select
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value as VoteChoice);
              setSalt(null);
              setCommitment(null);
              setBackupExported(false);
            }}
            disabled={!commitPhaseOpen || busy || !!existingCommitment}
          >
            {VOTE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <div className="commit-reveal-voter__actions">
          <button
            type="button"
            onClick={handleGenerateCommitment}
            disabled={!commitPhaseOpen || busy || !!existingCommitment}
          >
            Generate Commitment
          </button>
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={!salt || !commitment || busy}
          >
            Export Encrypted Backup
          </button>
          <button
            type="button"
            onClick={handleCommit}
            disabled={
              !commitPhaseOpen ||
              busy ||
              !salt ||
              !commitment ||
              !backupExported ||
              !!existingCommitment
            }
          >
            {busy ? "Submitting…" : "Submit Commit"}
          </button>
        </div>

        {commitment && (
          <div className="commit-reveal-voter__commitment">
            <span>Commitment:</span>
            <code>{commitment}</code>
          </div>
        )}
        {!backupExported && salt && (
          <p className="commit-reveal-voter__warning" role="alert">
            Export your encrypted reveal backup before committing. Losing the
            salt before reveal causes slashing.
          </p>
        )}
      </fieldset>

      {/* Phase 2: Reveal */}
      <fieldset
        className="commit-reveal-voter__phase-block"
        disabled={!revealPhaseOpen || busy || hasRevealed}
      >
        <legend>Phase 2 — Reveal</legend>

        {phase === "commit" && (
          <p className="commit-reveal-voter__notice">
            Reveal is disabled until the commit phase closes.
          </p>
        )}
        {phase === "awaiting-reveal" && (
          <p className="commit-reveal-voter__notice">
            Commit phase closed. Reveal opens in{" "}
            {formatCountdown(revealStart)}.
          </p>
        )}
        {phase === "closed" && (
          <p className="commit-reveal-voter__notice">
            The reveal deadline has passed. Reveal is no longer allowed.
          </p>
        )}

        <label className="commit-reveal-voter__field">
          <span>Import reveal backup</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportBackup(file);
              e.target.value = "";
            }}
            disabled={busy}
          />
        </label>

        <div className="commit-reveal-voter__actions">
          <button
            type="button"
            onClick={handleReveal}
            disabled={
              !revealPhaseOpen ||
              busy ||
              !salt ||
              !commitment ||
              hasRevealed
            }
          >
            {busy ? "Submitting…" : "Submit Reveal"}
          </button>
        </div>

        {hasRevealed && (
          <p className="commit-reveal-voter__notice">
            Your vote has already been revealed.
          </p>
        )}
      </fieldset>
    </section>
  );
};

export default CommitRevealVoter;
