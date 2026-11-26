/**
 * packages/ui/src/components/states/index.ts
 *
 * Barrel export for the Cypher GridPay state-pattern library.
 * Import from this file so tree-shaking removes unused state families.
 *
 *   import { EmptyState, NoEscrowsEmptyState } from '@cgp/ui/states';
 *   import { PaymentTableSkeleton }            from '@cgp/ui/states';
 *   import { ArchivedEntryBanner }             from '@cgp/ui/states';
 *   import { ErrorRecoveryCard, parseGridPayError } from '@cgp/ui/states';
 *
 * Issue: #418
 */

// ── Skeleton loaders ─────────────────────────────────────────────────────────
export {
  SkeletonBase,
  KpiCardSkeleton,
  KpiCardGridSkeleton,
  PaymentTableSkeleton,
  EscrowTimelineSkeleton,
  DetailHeaderSkeleton,
} from "./TableSkeleton";

export type {
  SkeletonBaseProps,
  KpiCardSkeletonProps,
  KpiCardGridSkeletonProps,
  PaymentTableSkeletonProps,
  EscrowTimelineSkeletonProps,
  DetailHeaderSkeletonProps,
} from "./TableSkeleton";

// ── Empty states ─────────────────────────────────────────────────────────────
export {
  EmptyState,
  NoEscrowsEmptyState,
  NoPaymentsEmptyState,
  FilteredEmptyState,
  SearchEmptyState,
  NoTransactionHistory,
} from "./EmptyState";

export type {
  EmptyStateAction,
  EmptyStateProps,
} from "./EmptyState";

// ── Archived Soroban entry ───────────────────────────────────────────────────
export {
  ArchivedEntryBanner,
  ArchivedInlineBadge,
} from "./ArchivedEntryBanner";

export type {
  ArchivedEntryBannerProps,
  ArchivedInlineBadgeProps,
} from "./ArchivedEntryBanner";

// ── Error recovery ───────────────────────────────────────────────────────────
export {
  ErrorRecoveryCard,
  RawErrorRecoveryCard,
  parseGridPayError,
  GRIDPAY_ERROR_CATALOGUE,
} from "./ErrorRecoveryCard";

export type {
  GridPayError,
  ErrorSeverity,
  ErrorRetryability,
  RawError,
  ErrorRecoveryCardProps,
  RawErrorRecoveryCardProps,
} from "./ErrorRecoveryCard";
