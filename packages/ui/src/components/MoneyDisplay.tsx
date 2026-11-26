import React from 'react';

export type MoneyAsset = 'USDC' | 'XLM';

export interface MoneyDisplayProps {
  /** Raw amount in display units (already converted from stroops). */
  amount: string | number | bigint;
  asset: MoneyAsset;
  /** Optional fiat/USD equivalent shown in a tooltip. */
  fiatEquivalent?: string;
  /** Signed indicator: positive net settlement, negative fee deduction. */
  sign?: 'positive' | 'negative' | 'none';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses: Record<NonNullable<MoneyDisplayProps['size']>, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

function splitAmount(amount: string): { integer: string; fraction: string } {
  const [integer, fraction = ''] = amount.split('.');
  return { integer, fraction };
}

function trimTrailingZeros(fraction: string): { significant: string; trailing: string } {
  const match = fraction.match(/^(.*?)(0*)$/);
  if (!match) return { significant: fraction, trailing: '' };
  return { significant: match[1], trailing: match[2] };
}

export function MoneyDisplay({
  amount,
  asset,
  fiatEquivalent,
  sign = 'none',
  size = 'md',
  className = '',
}: MoneyDisplayProps) {
  const raw = typeof amount === 'bigint' ? amount.toString() : String(amount);
  const { integer, fraction } = splitAmount(raw);
  const { significant, trailing } = trimTrailingZeros(fraction);

  const prefix = sign === 'positive' ? '+' : sign === 'negative' ? '-' : '';
  const signColor =
    sign === 'positive'
      ? 'text-emerald-600 dark:text-emerald-400'
      : sign === 'negative'
        ? 'text-red-600 dark:text-red-400'
        : 'text-slate-900 dark:text-slate-100';

  return (
    <span
      className={`inline-flex items-baseline gap-1 font-mono tabular-nums ${sizeClasses[size]} ${signColor} ${className}`}
      aria-label={`${prefix}${raw} ${asset}${fiatEquivalent ? `, approximately ${fiatEquivalent}` : ''}`}
    >
      {prefix && <span aria-hidden="true">{prefix}</span>}
      <span>
        {integer}
        {significant && (
          <span>
            .{significant}
            {trailing && <span className="text-slate-400 dark:text-slate-500">{trailing}</span>}
          </span>
        )}
      </span>
      <span
        className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        title={fiatEquivalent ? `≈ ${fiatEquivalent}` : undefined}
      >
        {asset}
      </span>
    </span>
  );
}

export default MoneyDisplay;
