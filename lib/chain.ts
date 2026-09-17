import { createClient } from 'genlayer-js';
import { studioDevnet, testnetBradbury } from 'genlayer-js/chains';
import {
  TransactionHashVariant,
  type CalldataEncodable,
  type TransactionHash,
} from 'genlayer-js/types';
import {
  createTransactionKit,
  type FeePreset,
  type PolicyQuote,
  type SubmitInput,
} from '@genlayer/transaction-kit';
import type { EIP1193Provider } from 'viem';
import {
  validAddress,
  type AgentRecord,
  type Task,
} from './agenthon.ts';
import { assertSuccess } from './receipt.ts';
import { walletError } from './errors.ts';
import { suggestionsFor } from './fees.ts';
import {
  prepareWallet,
  signingProvider,
  type BrowserProvider,
  type WalletSession,
} from './wallet.ts';

export type NetworkName = 'studioDevnet' | 'testnetBradbury';
export type ChainConfig = { network: NetworkName; contract: string };
export type Pending = {
  hash: `0x${string}`;
  action: string;
  taskId?: string;
  config: ChainConfig;
};
export const networks = { studioDevnet, testnetBradbury };
export function readClient(config: ChainConfig) {
  return createClient({ chain: networks[config.network] });
}
export async function walletClient(
  config: ChainConfig,
  provider: BrowserProvider,
  expectedAddress?: string,
) {
  try {
    const address = await prepareWallet(
      provider,
      networks[config.network],
      expectedAddress,
    );
    const client = createClient({
      chain: networks[config.network],
      account: address as `0x${string}`,
      provider: signingProvider(
        { provider, address },
        networks[config.network],
      ) as EIP1193Provider,
    });
    return { client, address };
  } catch (error) {
    throw new Error(walletError(error, 'wallet connection and network setup'));
  }
}
export function requireContract(config: ChainConfig): `0x${string}` {
  if (!validAddress(config.contract))
    throw new Error('Set a deployed Agenthon contract in Network settings.');
  return config.contract as `0x${string}`;
}
export async function readTask(config: ChainConfig, id: string): Promise<Task> {
  const raw = await readClient(config).readContract({
    address: requireContract(config),
    functionName: 'get_task',
    args: [id],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  if (typeof raw !== 'string') throw new Error('Unexpected contract response.');
  const task = JSON.parse(raw);
  if (!task.id || !Array.isArray(task.rubric))
    throw new Error('This address did not return an Agenthon task.');
  return { ...task, origin: 'chain' };
}
export async function readAgent(
  config: ChainConfig,
  address: string,
): Promise<AgentRecord> {
  const raw = await readClient(config).readContract({
    address: requireContract(config),
    functionName: 'get_agent',
    args: [address],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  if (typeof raw !== 'string') throw new Error('Unexpected contract response.');
  const record = JSON.parse(raw);
  if (typeof record.graded !== 'number' || typeof record.average !== 'number')
    throw new Error('This address did not return an Agenthon agent record.');
  return record as AgentRecord;
}
export async function listTasks(
  config: ChainConfig,
  offset = 0,
): Promise<{ tasks: Task[]; hasMore: boolean }> {
  const client = readClient(config);
  const address = requireContract(config);
  const version = await client.readContract({
    address,
    functionName: 'get_version',
    args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  if (version !== 'agenthon/1.0')
    throw new Error('The selected contract is not Agenthon 1.0.');
  const ids = await client.readContract({
    address,
    functionName: 'list_tasks',
    args: [offset, 12],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  if (!Array.isArray(ids)) throw new Error('Could not read the brief list.');
  return {
    tasks: await Promise.all(
      ids.map((id) => {
        if (typeof id !== 'string')
          throw new Error('Invalid task ID returned by contract.');
        return readTask(config, id);
      }),
    ),
    hasMore: ids.length === 12,
  };
}
export async function track(pending: Pending) {
  const receipt = await readClient(pending.config).waitForTransactionReceipt({
    hash: pending.hash as TransactionHash,
    // v0.6 replaced `status` with `waitUntil`: exact fee consumption and
    // refunds are only settled at finalization.
    waitUntil: 'finalized',
    interval: 4000,
    retries: 15,
  });
  assertSuccess(receipt);
  return receipt;
}
/**
 * Appeal posture for user-facing writes. The kit's standard posture funds three
 * appeal rounds; unused fee budget is refunded at finalization.
 */
export const FEE_PRESET: FeePreset = 'standard';

function actionKit(
  config: ChainConfig,
  session: WalletSession,
  address: string,
  tx: SubmitInput,
) {
  const chain = networks[config.network];
  return createTransactionKit({
    chain,
    // Keep the SDK bound to the selected extension, exactly as the read path does.
    provider: signingProvider({ provider: session.provider, address }, chain),
    account: address as `0x${string}`,
    suggestions: suggestionsFor(tx),
  });
}

/** Quote a deploy or write without signing anything. */
export async function estimateFee(
  config: ChainConfig,
  session: WalletSession,
  tx: SubmitInput,
  userValue = 0n,
  preset: FeePreset = FEE_PRESET,
): Promise<PolicyQuote> {
  const chain = networks[config.network];
  const address = await prepareWallet(
    session.provider,
    chain,
    session.address,
  );
  return actionKit(config, session, address, tx).estimate(
    { preset, userValue },
    tx,
  );
}

async function signAndSubmit(
  config: ChainConfig,
  session: WalletSession,
  tx: SubmitInput,
  userValue: bigint,
  onQuote?: (quote: PolicyQuote) => void,
): Promise<`0x${string}`> {
  const chain = networks[config.network];
  const address = await prepareWallet(
    session.provider,
    chain,
    session.address,
  );
  const kit = actionKit(config, session, address, tx);
  const quote = await kit.estimate({ preset: FEE_PRESET, userValue }, tx);
  // A stale quote means prices moved under the estimate; make the user re-read it.
  if (quote.verification.status === 'mismatch')
    throw new Error(
      'Network fee prices changed while this estimate was built. Review the updated fee estimate and try again.',
    );
  onQuote?.(quote);
  const { genlayerTxId } = await kit.submit(quote, tx);
  return genlayerTxId as `0x${string}`;
}

export async function send(
  config: ChainConfig,
  session: WalletSession,
  action: string,
  args: CalldataEncodable[],
  value = 0n,
  onQuote?: (quote: PolicyQuote) => void,
) {
  const tx: SubmitInput = {
    kind: 'write',
    address: requireContract(config),
    method: action,
    args,
  };
  return signAndSubmit(config, session, tx, value, onQuote);
}

export async function deploy(
  config: ChainConfig,
  session: WalletSession,
  onQuote?: (quote: PolicyQuote) => void,
) {
  const response = await fetch('/contracts/agenthon.py');
  if (!response.ok) throw new Error('Contract source is unavailable.');
  const tx: SubmitInput = {
    kind: 'deploy',
    code: await response.text(),
    args: [],
    leaderOnly: false,
  };
  return signAndSubmit(config, session, tx, 0n, onQuote);
}

