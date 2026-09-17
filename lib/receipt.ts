import {
  transactionsStatusNumberToName,
  executionResultNumberToName,
  TransactionStatus,
  type GenLayerTransaction,
} from 'genlayer-js/types';
export function receiptStatus(receipt: GenLayerTransaction) {
  const names = receipt as unknown as {
    statusName?: string;
    status_name?: string;
    status?: number | string;
  };
  return (
    names.statusName ??
    names.status_name ??
    (typeof names.status === 'number'
      ? transactionsStatusNumberToName[
          String(names.status) as keyof typeof transactionsStatusNumberToName
        ]
      : names.status)
  );
}
/**
 * Whether the validator set accepted the round's result.
 *
 * A round can execute cleanly and still write nothing: validators vote on the
 * leader's result, and a majority that cannot agree finalizes the transaction
 * as undetermined with every state change discarded. Success therefore needs
 * both a clean execution and an agreed consensus, or the app would report a
 * write that never happened.
 */
export function consensusOutcome(receipt: GenLayerTransaction) {
  const raw = receipt as unknown as {
    lifecycle?: { outcome?: string };
    result_name?: string;
    resultName?: string;
  };
  if (raw.lifecycle?.outcome) return raw.lifecycle.outcome;
  const name = raw.result_name ?? raw.resultName;
  if (typeof name !== 'string') return null;
  if (name === 'MAJORITY_AGREE' || name === 'AGREE') return 'accepted';
  return 'undetermined';
}
export class FinalizedFailure extends Error {}
export class ConsensusFailure extends Error {}
export function assertSuccess(receipt: GenLayerTransaction) {
  const status = receiptStatus(receipt);
  if (status !== TransactionStatus.FINALIZED)
    throw new Error(
      `Transaction is ${status ?? 'pending'}. Keep tracking the existing transaction.`,
    );
  const result =
    receipt.txExecutionResultName ??
    (typeof receipt.txExecutionResult === 'number'
      ? executionResultNumberToName[
          String(
            receipt.txExecutionResult,
          ) as keyof typeof executionResultNumberToName
        ]
      : undefined);
  const finalLeader = receipt.consensus_data?.leader_receipt
    ?.filter((r) => r.mode === 'leader')
    .at(-1);
  const successful = result
    ? result === 'FINISHED_WITH_RETURN'
    : finalLeader?.execution_result === 'SUCCESS';
  if (!successful)
    throw new FinalizedFailure(
      `Transaction ${receipt.hash ?? receipt.txId ?? ''} finalized without successful execution (${result ?? finalLeader?.execution_result ?? 'unknown'}).`,
    );
  const outcome = consensusOutcome(receipt);
  if (outcome && outcome !== 'accepted')
    throw new ConsensusFailure(
      'GenLayer validators did not agree on this round, so the contract wrote nothing. The call is safe to send again.',
    );
}
