/**
 * Fee profile handling for GenLayer consensus v0.6.
 *
 * The profile is a checked-in artifact measured by the contract test suite
 * (`npm run test:fees`). Prices and caps are always read live from the network
 * at signing time — only the allocation parameters are measured offline.
 *
 * Until a method has a measured allocation, no suggestion is handed to the
 * transaction kit, so quotes are labelled `network-default` rather than
 * claiming a developer profile that was never measured.
 */
import type {
  FeeSuggestions,
  SubmitInput,
  SuggestedFees,
} from '@genlayer/transaction-kit';
import feeProfile from './fee-profile.json' with { type: 'json' };

/** Studio Next — the network this submission targets. */
export const STUDIO_NEXT_CHAIN_ID = 61997;

export const feeSuggestions = feeProfile as FeeSuggestions;

function isMeasured(entry?: SuggestedFees): boolean {
  if (!entry) return false;
  return Object.values(entry).some(
    (value) => value !== undefined && value !== null && value !== '',
  );
}

/** The measured allocation for this call, if the profile has one. */
export function profileEntry(tx: SubmitInput): SuggestedFees | undefined {
  const entry =
    tx.kind === 'deploy'
      ? feeSuggestions.deploy
      : feeSuggestions.methods?.[tx.method];
  return isMeasured(entry) ? entry : undefined;
}

/**
 * A profile is only handed to the kit when this call has a measured entry;
 * the kit ignores profiles whose `chainId` does not match the active chain.
 */
export function suggestionsFor(tx: SubmitInput): FeeSuggestions | undefined {
  return profileEntry(tx) ? feeSuggestions : undefined;
}

export function profileMatchesChain(chainId: number): boolean {
  const declared = feeSuggestions.chainId;
  if (declared === undefined || declared === null) return false;
  try {
    return BigInt(declared) === BigInt(chainId);
  } catch {
    return false;
  }
}

const ACCOUNTING_KEYS = [
  'paid_fee_value',
  'required_fee_value',
  'primary_fee_spent',
  'total_refunded',
] as const;

function looksLikeAccounting(value: Record<string, unknown>): boolean {
  return ACCOUNTING_KEYS.some((key) => key in value);
}

/**
 * Fee accounting is reported by the finalized transaction. Its exact location
 * has moved between releases, so search the receipt for the accounting record
 * instead of assuming a single path, and report nothing when it is absent.
 */
export function findFeeAccounting(
  value: unknown,
  depth = 0,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const record = value as Record<string, unknown>;
  if (looksLikeAccounting(record)) return record;
  const nested = record.feeAccounting ?? record.fee_accounting;
  if (nested && typeof nested === 'object' && looksLikeAccounting(nested as Record<string, unknown>))
    return nested as Record<string, unknown>;
  for (const child of Object.values(record)) {
    const found = findFeeAccounting(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export type FeeUsage = {
  deposit?: string;
  consumed?: string;
  refunded?: string;
};

function amount(value: unknown): string | undefined {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return undefined;
}

/** Deposit, consumed and refunded fees stay distinct; never netted together. */
export function feeUsage(receipt: unknown): FeeUsage | undefined {
  const accounting = findFeeAccounting(receipt);
  if (!accounting) return undefined;
  const deposit =
    amount(accounting.paid_fee_value) ?? amount(accounting.required_fee_value);
  const consumed = amount(accounting.primary_fee_spent);
  const refunded = amount(accounting.total_refunded);
  if (!deposit && !consumed && !refunded) return undefined;
  return { deposit, consumed, refunded };
}
