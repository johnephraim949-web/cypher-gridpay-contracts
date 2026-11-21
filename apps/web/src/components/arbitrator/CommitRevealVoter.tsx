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
