// apps/web/src/utils/exifStripper.ts
//
// Client-side privacy utilities for the Dispute Resolution & Evidence Submission Portal.
//
// Responsibilities:
//   1. Strip EXIF / GPS / XMP metadata from uploaded evidence images by re-encoding
//      them through an offscreen canvas (JPEG / PNG / WebP).
//   2. Pass non-image files through untouched (they carry no image metadata).
//   3. Validate file type, per-file size, and bulk evidence count against the
//      contract bounds before any upload is initiated.
//
// All functions are pure / side-effect free except for the canvas re-encoding
// step, which requires a DOM environment (browser). The sanitized bytes returned
// by `stripImageMetadata` are ready to be fed into the SHA-256 / CIDv1 hasher.

/** Contract-aligned evidence constraints. Keep in sync with the Soroban contract. */
export const EVIDENCE_LIMITS = {
  /** Maximum size of a single evidence file, in bytes (10 MiB). */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  /** Maximum number of evidence files per dispute / refund case. */
  MAX_BULK_EVIDENCE_COUNT: 10,
  /** MIME types accepted as evidence. */
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain',
  ] as const,
  /** Image MIME types that will be re-encoded to strip metadata. */
  STRIPPABLE_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

export type AllowedMimeType = (typeof EVIDENCE_LIMITS.ALLOWED_MIME_TYPES)[number];
export type StrippableImageType = (typeof EVIDENCE_LIMITS.STRIPPABLE_IMAGE_TYPES)[number];

/** Result of a validation check. */
export interface ValidationResult {
  valid: boolean;
  /** Human-readable reason when `valid === false`. */
  reason?: string;
}

/** Result of stripping metadata from a file. */
export interface SanitizedFile {
  /** Sanitized bytes, ready for hashing and upload. */
  bytes: Uint8Array;
  /** MIME type of the sanitized output. */
  mimeType: string;
  /** Original file name (preserved for display purposes). */
  fileName: string;
  /** Size of the sanitized output in bytes. */
  size: number;
  /** Whether the file was re-encoded (true) or passed through (false). */
  reencoded: boolean;
}

const IMAGE_EXTENSION_BY_MIME: Record<StrippableImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Quality used when re-encoding lossy formats (JPEG / WebP). */
const REENCODE_QUALITY = 0.92;

function isStrippableImage(mimeType: string): mimeType is StrippableImageType {
  return (EVIDENCE_LIMITS.STRIPPABLE_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (EVIDENCE_LIMITS.ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Validates a single evidence file against the contract bounds.
 *
 * Checks:
 *   - MIME type is in the allow-list.
 *   - File size is within `MAX_FILE_SIZE_BYTES`.
 *   - File is non-empty.
 */
export function validateEvidenceFile(file: File): ValidationResult {
  if (!file) {
    return { valid: false, reason: 'No file provided.' };
  }

  if (file.size === 0) {
    return { valid: false, reason: `File "${file.name}" is empty.` };
  }

  if (file.size > EVIDENCE_LIMITS.MAX_FILE_SIZE_BYTES) {
    const maxMb = (EVIDENCE_LIMITS.MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      reason: `File "${file.name}" exceeds the maximum size of ${maxMb} MB.`,
    };
  }

  // Some browsers report an empty MIME type for unknown files; fall back to
  // the extension-based guess is intentionally NOT done here — we require an
  // explicit, allow-listed MIME type to avoid ambiguity.
  if (!file.type) {
    return {
      valid: false,
      reason: `File "${file.name}" has an unrecognized type. Allowed types: ${EVIDENCE_LIMITS.ALLOWED_MIME_TYPES.join(', ')}.`,
    };
  }

  if (!isAllowedMimeType(file.type)) {
    return {
      valid: false,
      reason: `File "${file.name}" has unsupported type "${file.type}". Allowed types: ${EVIDENCE_LIMITS.ALLOWED_MIME_TYPES.join(', ')}.`,
    };
  }

  return { valid: true };
}

/**
 * Validates a batch of evidence files against the contract bounds.
 *
 * Checks each file individually and enforces the bulk evidence count limit.
 */
export function validateEvidenceBatch(files: File[]): ValidationResult {
  if (!files || files.length === 0) {
    return { valid: false, reason: 'No evidence files selected.' };
  }

  if (files.length > EVIDENCE_LIMITS.MAX_BULK_EVIDENCE_COUNT) {
    return {
      valid: false,
      reason: `Too many evidence files (${files.length}). Maximum is ${EVIDENCE_LIMITS.MAX_BULK_EVIDENCE_COUNT}.`,
    };
  }

  for (const file of files) {
    const result = validateEvidenceFile(file);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}

/**
 * Returns the remaining evidence slots given the number of files already
 * attached to a case. Useful for disabling the uploader in the UI.
 */
export function remainingEvidenceSlots(currentCount: number): number {
  const remaining = EVIDENCE_LIMITS.MAX_BULK_EVIDENCE_COUNT - currentCount;
  return remaining > 0 ? remaining : 0;
}

/**
 * Reads a Blob/File into a Uint8Array.
 */
async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Re-encodes an image through an offscreen canvas, which discards all EXIF,
 * GPS, XMP, IPTC, and other embedded metadata. The resulting bytes contain
 * only pixel data and the minimal container headers required by the format.
 *
 * @param file   The source image file.
 * @param mime   The target MIME type (must be a strippable image type).
 * @returns      Sanitized image bytes.
 */
async function reencodeImage(file: File, mime: StrippableImageType): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error(
      'Image metadata stripping requires a browser environment with createImageBitmap support.',
    );
  }

  // Decode the image. `createImageBitmap` does not retain metadata in the
  // resulting bitmap, so re-encoding from it produces clean output.
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D canvas context for metadata stripping.');
    }

    // Draw the bitmap onto a fresh canvas. No metadata is carried over.
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      // PNG is lossless; JPEG/WebP use a high quality to minimize artifacts.
      const quality = mime === 'image/png' ? undefined : REENCODE_QUALITY;
      canvas.toBlob(resolve, mime, quality);
    });

    if (!blob) {
      throw new Error('Canvas re-encoding failed to produce output.');
    }

    return await readBlobBytes(blob);
  } finally {
    // Release the decoded bitmap eagerly.
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

/**
 * Strips EXIF / GPS metadata from an evidence file and returns sanitized bytes
 * ready for hashing and upload.
 *
 * - JPEG / PNG / WebP images are re-encoded through a canvas, removing all
 *   embedded metadata (EXIF, GPS, XMP, IPTC, comments).
 * - All other allow-listed files (PDF, plain text) are passed through
 *   unchanged, since they do not carry image metadata.
 *
 * Throws if the file fails validation or if re-encoding fails.
 */
export async function stripImageMetadata(file: File): Promise<SanitizedFile> {
  const validation = validateEvidenceFile(file);
  if (!validation.valid) {
    throw new Error(validation.reason ?? 'Invalid evidence file.');
  }

  if (isStrippableImage(file.type)) {
    const bytes = await reencodeImage(file, file.type);
    return {
      bytes,
      mimeType: file.type,
      fileName: file.name,
      size: bytes.byteLength,
      reencoded: true,
    };
  }

  // Non-image files: pass through untouched.
  const bytes = await readBlobBytes(file);
  return {
    bytes,
    mimeType: file.type,
    fileName: file.name,
    size: bytes.byteLength,
    reencoded: false,
  };
}

/**
 * Convenience helper: strips metadata from a batch of files, preserving order.
 * Rejects (throws) if any file is invalid or fails to process.
 */
export async function stripImageMetadataBatch(files: File[]): Promise<SanitizedFile[]> {
  const batchValidation = validateEvidenceBatch(files);
  if (!batchValidation.valid) {
    throw new Error(batchValidation.reason ?? 'Invalid evidence batch.');
  }

  const results: SanitizedFile[] = [];
  for (const file of files) {
    results.push(await stripImageMetadata(file));
  }
  return results;
}

/**
 * Returns the canonical file extension for a strippable image MIME type.
 * Useful when constructing content-addressed storage keys.
 */
export function extensionForMime(mimeType: string): string | undefined {
  if (isStrippableImage(mimeType)) {
    return IMAGE_EXTENSION_BY_MIME[mimeType];
  }
  return undefined;
}