/**
 * Fee quoting for the Node tooling, mirroring lib/chain.ts for the browser app.
 *
 * The allocation parameters come from the committed fee profile (measured by
 * the contract test suite); prices and caps are always read live from the
 * network at estimate time. Nothing here signs or sends a transaction.
 */
import { readFile } from 'node:fs/promises';
import { createTransactionKit } from '@genlayer/transaction-kit';

const PROFILE_PATH = 'lib/fee-profile.json';

/**
 * The kit needs an EIP-1193 provider, but these scripts only estimate; the one
 * optional provider read (pending queue depth) already tolerates failure.
 */
const estimatingProvider = {
  request: async () => {
    throw new Error('These scripts estimate fees without an injected wallet.');
  },
};

export async function readProfile() {
  try {
    return JSON.parse(await readFile(PROFILE_PATH, 'utf8'));
  } catch {
    return undefined;
  }
}

function measuredEntry(profile, tx) {
  if (!profile) return undefined;
  const entry =
    tx.kind === 'deploy' ? profile.deploy : profile.methods?.[tx.method];
  if (!entry) return undefined;
  const measured = Object.values(entry).some(
    (value) => value !== undefined && value !== null && value !== '',
  );
  return measured ? profile : undefined;
}

/** Quote a deploy or write. Returns the quote plus ready-to-spread fee args. */
export async function quote(
  chain,
  tx,
  { userValue = 0n, preset = 'standard' } = {},
) {
  const profile = await readProfile();
  const kit = createTransactionKit({
    chain,
    provider: estimatingProvider,
    suggestions: measuredEntry(profile, tx),
  });
  const estimate = await kit.estimate({ preset, userValue }, tx);
  // A gasless deployment takes no deposit; sending fee parameters would at best
  // be ignored and at worst rejected.
  const feeArgs = estimate.gasless
    ? {}
    : {
        fees: {
          distribution: estimate.distribution,
          feeValue: estimate.feeValue,
        },
      };
  return { estimate, feeArgs };
}

export function describeFee(estimate) {
  const parts = [
    estimate.gasless
      ? 'gasless (no deposit taken)'
      : `deposit ${estimate.feeValue} wei`,
    `source ${estimate.source}`,
    `prices ${estimate.verification?.status ?? 'unavailable'}`,
  ];
  if (estimate.queue) parts.push(`${estimate.queue.pendingAhead} pending ahead`);
  return parts.join(', ');
}
