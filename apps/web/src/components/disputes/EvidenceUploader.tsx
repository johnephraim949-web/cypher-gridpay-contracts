import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripExifFromImage } from "../../utils/exifStripper";

/**
 * EvidenceUploader
 *
 * Client-side evidence uploader for escrow disputes and refund appeals.
 *
 * Responsibilities:
 *  - Enforce client-side file type, max file size, and max bulk evidence count
 *    limits matching contract bounds before initiating uploads.
 *  - Strip EXIF/GPS metadata from image evidence before hashing/upload.
 *  - Compute deterministic SHA-256 and CIDv1 (raw codec, sha2-256 multihash,
 *    base32 multibase) hashes in-browser using the Web Crypto API.
 *  - Upload encrypted/content-addressed blobs via the backend evidence API.
 *  - Submit the commitment hash on-chain via the provided callback.
 */

// ---------------------------------------------------------------------------
// Contract-aligned limits. These MUST match the on-chain bounds enforced by the
// escrow/refund contracts. Keep in sync with contract constants.
// ---------------------------------------------------------------------------
export const EVIDENCE_LIMITS = {
  /** Maximum size of a single evidence file in bytes (10 MiB). */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  /** Maximum number of evidence files per submission (bulk limit). */
  MAX_BULK_COUNT: 10,
  /** Allowed MIME types for evidence. */
  ALLOWED_MIME_TYPES: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
    "text/plain",
  ] as const,
  /** Allowed file extensions (lowercase, without dot). */
  ALLOWED_EXTENSIONS: ["png", "jpg", "jpeg", "webp", "gif", "pdf", "txt"] as const,
} as const;

export type EvidenceKind = "escrow_dispute" | "refund_appeal";

export interface EvidenceCommitment {
  /** Deterministic SHA-256 hex digest of the (EXIF-stripped) content. */
  sha256: string;
  /** CIDv1 (raw codec, sha2-256 multihash, base32 multibase). */
  cid: string;
  /** Original file name (sanitized). */
  fileName: string;
  /** MIME type of the uploaded content. */
  mimeType: string;
  /** Size in bytes of the (EXIF-stripped) content. */
  sizeBytes: number;
  /** Backend content-addressed storage reference (e.g. object key / URL). */
  storageRef: string;
}

export interface EvidenceUploaderProps {
  /** Which on-chain record this evidence is attached to. */
  kind: EvidenceKind;
  /** Identifier of the dispute / refund record on-chain. */
  recordId: string;
  /**
   * Uploads a content-addressed blob to the backend evidence API and returns
   * a storage reference. The backend is expected to verify the CID.
   */
  uploadEvidence: (params: {
    kind: EvidenceKind;
    recordId: string;
    cid: string;
    sha256: string;
    fileName: string;
    mimeType: string;
    blob: Blob;
  }) => Promise<{ storageRef: string }>;
  /**
   * Submits the commitment hash on-chain. Called once per accepted file after
   * a successful backend upload.
   */
  submitCommitment: (params: {
    kind: EvidenceKind;
    recordId: string;
    commitment: EvidenceCommitment;
  }) => Promise<void>;
  /** Optional callback fired whenever the set of commitments changes. */
  onCommitmentsChange?: (commitments: EvidenceCommitment[]) => void;
  /** Optional disabled flag (e.g. deadline passed). */
  disabled?: boolean;
  /** Optional reason shown when disabled. */
  disabledReason?: string;
}

interface PendingFile {
  id: string;
  file: File;
  status: "queued" | "processing" | "uploading" | "submitting" | "done" | "error";
  error?: string;
  commitment?: EvidenceCommitment;
}

// ---------------------------------------------------------------------------
// Hashing helpers (Web Crypto)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32 (lowercase, no padding) — used by CIDv1 multibase 'b'. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Computes the SHA-256 digest of the given bytes. */
export async function sha256Digest(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const buffer =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer);
  return new Uint8Array(digest);
}

/**
 * Builds a CIDv1 for the given content using the `raw` codec (0x55) and a
 * sha2-256 multihash (0x12, length 0x20), encoded with base32 multibase ('b').
 *
 * CIDv1 binary layout:
 *   <version=0x01><codec=0x55><multihash: 0x12 0x20 <32-byte digest>>
 */
export function buildCidV1Raw(digest: Uint8Array): string {
  if (digest.length !== 32) {
    throw new Error("CIDv1 raw sha2-256 requires a 32-byte digest");
  }
  const cidBytes = new Uint8Array(4 + digest.length);
  cidBytes[0] = 0x01; // CID version 1
  cidBytes[1] = 0x55; // raw codec
  cidBytes[2] = 0x12; // sha2-256 multihash code
  cidBytes[3] = 0x20; // digest length (32)
  cidBytes.set(digest, 4);
  return "b" + base32Encode(cidBytes);
}

/** Computes both the SHA-256 hex digest and CIDv1 for the given bytes. */
export async function computeContentHashes(
  data: ArrayBuffer | Uint8Array,
): Promise<{ sha256: string; cid: string }> {
  const digest = await sha256Digest(data);
  return {
    sha256: bytesToHex(digest),
    cid: buildCidV1Raw(digest),
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/**
 * Validates a single file against the contract-aligned evidence bounds.
 * Exported for unit testing.
 */
export function validateEvidenceFile(file: File): ValidationResult {
  if (!file || typeof file.size !== "number") {
    return { ok: false, error: "Invalid file." };
  }
  if (file.size === 0) {
    return { ok: false, error: `"${file.name}" is empty.` };
  }
  if (file.size > EVIDENCE_LIMITS.MAX_FILE_SIZE_BYTES) {
    const maxMb = (EVIDENCE_LIMITS.MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      error: `"${file.name}" exceeds the maximum evidence size of ${maxMb} MiB.`,
    };
  }
  const mime = (file.type || "").toLowerCase();
  const ext = getExtension(file.name);
  const mimeAllowed = (EVIDENCE_LIMITS.ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
  const extAllowed = (EVIDENCE_LIMITS.ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
  if (!mimeAllowed && !extAllowed) {
    return {
      ok: false,
      error: `"${file.name}" has an unsupported type. Allowed: ${EVIDENCE_LIMITS.ALLOWED_EXTENSIONS.join(
        ", ",
      )}.`,
    };
  }
  return { ok: true };
}

/**
 * Validates a batch of files against per-file bounds and the bulk count limit.
 * Exported for unit testing.
 */
export function validateEvidenceBatch(
  files: File[],
  existingCount = 0,
): { accepted: File[]; errors: string[] } {
  const errors: string[] = [];
  const accepted: File[] = [];
  const remainingSlots = Math.max(0, EVIDENCE_LIMITS.MAX_BULK_COUNT - existingCount);

  if (files.length > remainingSlots) {
    errors.push(
      `You can attach at most ${EVIDENCE_LIMITS.MAX_BULK_COUNT} evidence files per submission ` +
        `(${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} remaining).`,
    );
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (i >= remainingSlots) {
      // Already reported the bulk error; skip silently to avoid noise.
      continue;
    }
    const result = validateEvidenceFile(file);
    if (result.ok) {
      accepted.push(file);
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return { accepted, errors };
}

// ---------------------------------------------------------------------------
// Content preparation (EXIF stripping)
// ---------------------------------------------------------------------------

async function prepareContent(file: File): Promise<{ blob: Blob; mimeType: string }> {
  const mime = (file.type || "").toLowerCase();
  if (isImageMime(mime)) {
    try {
      const stripped = await stripExifFromImage(file);
      return { blob: stripped, mimeType: stripped.type || mime };
    } catch {
      // If EXIF stripping fails for any reason, refuse to upload the raw image
      // to avoid leaking metadata (privacy invariant).
      throw new Error(
        `Could not strip metadata from "${file.name}". Please re-export the image and try again.`,
      );
    }
  }
  return { blob: file, mimeType: mime || "application/octet-stream" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `ev_${Date.now()}_${idCounter}`;
}

export const EvidenceUploader: React.FC<EvidenceUploaderProps> = ({
  kind,
  recordId,
  uploadEvidence,
  submitCommitment,
  onCommitmentsChange,
  disabled = false,
  disabledReason,
}) => {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const completedCommitments = useMemo(
    () =>
      pending
        .filter((p) => p.status === "done" && p.commitment)
        .map((p) => p.commitment as EvidenceCommitment),
    [pending],
  );

  useEffect(() => {
    onCommitmentsChange?.(completedCommitments);
  }, [completedCommitments, onCommitmentsChange]);

  const updatePending = useCallback((id: string, patch: Partial<PendingFile>) => {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const processFile = useCallback(
    async (entry: PendingFile) => {
      const { file, id } = entry;
      try {
        updatePending(id, { status: "processing", error: undefined });

        // 1. Strip EXIF / metadata (images only) before hashing.
        const { blob, mimeType } = await prepareContent(file);

        // Re-validate size after stripping (should be <= original, but be safe).
        if (blob.size > EVIDENCE_LIMITS.MAX_FILE_SIZE_BYTES) {
          throw new Error(`"${file.name}" exceeds the maximum evidence size after processing.`);
        }

        // 2. Compute deterministic SHA-256 + CIDv1 in-browser.
        const buffer = await blob.arrayBuffer();
        const { sha256, cid } = await computeContentHashes(buffer);

        // 3. Upload content-addressed blob to backend evidence API.
        updatePending(id, { status: "uploading" });
        const { storageRef } = await uploadEvidence({
          kind,
          recordId,
          cid,
          sha256,
          fileName: file.name,
          mimeType,
          blob,
        });
        if (!storageRef) {
          throw new Error("Backend did not return a storage reference.");
        }

        const commitment: EvidenceCommitment = {
          sha256,
          cid,
          fileName: file.name,
          mimeType,
          sizeBytes: blob.size,
          storageRef,
        };

        // 4. Submit the commitment hash on-chain.
        updatePending(id, { status: "submitting" });
        await submitCommitment({ kind, recordId, commitment });

        if (mountedRef.current) {
          updatePending(id, { status: "done", commitment });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Evidence upload failed.";
        if (mountedRef.current) {
          updatePending(id, { status: "error", error: message });
        }
      }
    },
    [kind, recordId, uploadEvidence, submitCommitment, updatePending],
  );

  const handleFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      if (disabled || !fileList) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const existingCount = pending.length;
      const { accepted, errors: validationErrors } = validateEvidenceBatch(files, existingCount);

      setErrors(validationErrors);

      if (accepted.length === 0) return;

      const entries: PendingFile[] = accepted.map((file) => ({
        id: nextId(),
        file,
        status: "queued",
      }));

      setPending((prev) => [...prev, ...entries]);

      // Kick off processing sequentially to keep memory pressure low and
      // preserve deterministic ordering of on-chain submissions.
      void (async () => {
        for (const entry of entries) {
          if (!mountedRef.current) break;
          // eslint-disable-next-line no-await-in-loop
          await processFile(entry);
        }
      })();
    },
    [disabled, pending.length, processFile],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset so selecting the same file again re-triggers change.
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      handleFiles(e.dataTransfer?.files ?? null);
    },
    [disabled, handleFiles],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!disabled) setIsDragging(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeEntry = useCallback((id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const retryEntry = useCallback(
    (id: string) => {
      setPending((prev) => {
        const entry = prev.find((p) => p.id === id);
        if (!entry) return prev;
        const reset: PendingFile = { ...entry, status: "queued", error: undefined };
        void processFile(reset);
        return prev.map((p) => (p.id === id ? reset : p));
      });
    },
    [processFile],
  );

  const remainingSlots = Math.max(0, EVIDENCE_LIMITS.MAX_BULK_COUNT - pending.length);
  const maxMb = (EVIDENCE_LIMITS.MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);

  return (
    <div className="evidence-uploader" data-testid="evidence-uploader">
      <div className="evidence-uploader__header">
        <h3>Evidence</h3>
        <p className="evidence-uploader__hint">
          Attach up to {EVIDENCE_LIMITS.MAX_BULK_COUNT} files, max {maxMb} MiB each. Allowed types:{" "}
          {EVIDENCE_LIMITS.ALLOWED_EXTENSIONS.join(", ")}. Image metadata (EXIF/GPS) is removed
          before upload.
        </p>
      </div>

      {disabled && (
        <div className="evidence-uploader__disabled" role="alert">
          {disabledReason ?? "Evidence submission is currently disabled."}
        </div>
      )}

      <div
        className={`evidence-uploader__dropzone${isDragging ? " is-dragging" : ""}${
          disabled ? " is-disabled" : ""
        }`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={EVIDENCE_LIMITS.ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
          onChange={onInputChange}
          disabled={disabled || remainingSlots === 0}
          style={{ display: "none" }}
          data-testid="evidence-file-input"
        />
        <p>
          {remainingSlots === 0
            ? "Maximum number of evidence files reached."
            : "Drag & drop files here, or click to browse."}
        </p>
        <p className="evidence-uploader__slots">
          {remainingSlots} of {EVIDENCE_LIMITS.MAX_BULK_COUNT} slots remaining
        </p>
      </div>

      {errors.length > 0 && (
        <ul className="evidence-uploader__errors" role="alert" data-testid="evidence-errors">
          {errors.map((err, idx) => (
            <li key={idx}>{err}</li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="evidence-uploader__list" data-testid="evidence-list">
          {pending.map((entry) => (
            <li key={entry.id} className={`evidence-uploader__item status-${entry.status}`}>
              <div className="evidence-uploader__item-main">
                <span className="evidence-uploader__name">{entry.file.name}</span>
                <span className="evidence-uploader__size">
                  {(entry.file.size / 1024).toFixed(1)} KiB
                </span>
                <span className="evidence-uploader__status">{renderStatus(entry)}</span>
              </div>

              {entry.commitment && (
                <div className="evidence-uploader__commitment">
                  <div>
                    <span className="label">CID:</span>{" "}
                    <code data-testid="evidence-cid">{entry.commitment.cid}</code>
                  </div>
                  <div>
                    <span className="label">SHA-256:</span>{" "}
                    <code data-testid="evidence-sha256">{entry.commitment.sha256}</code>
                  </div>
                </div>
              )}

              {entry.error && (
                <div className="evidence-uploader__item-error" role="alert">
                  {entry.error}
                </div>
              )}

              <div className="evidence-uploader__item-actions">
                {entry.status === "error" && (
                  <button type="button" onClick={() => retryEntry(entry.id)}>
                    Retry
                  </button>
                )}
                {(entry.status === "queued" ||
                  entry.status === "error" ||
                  entry.status === "done") && (
                  <button type="button" onClick={() => removeEntry(entry.id)}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

function renderStatus(entry: PendingFile): string {
  switch (entry.status) {
    case "queued":
      return "Queued";
    case "processing":
      return "Stripping metadata & hashing…";
    case "uploading":
      return "Uploading…";
    case "submitting":
      return "Submitting commitment on-chain…";
    case "done":
      return "Committed";
    case "error":
      return "Failed";
    default:
      return "";
  }
}

export default EvidenceUploader;