import {
  transactionsStatusNumberToName,
  executionResultNumberToName,
  TransactionStatus,
  type GenLayerTransaction,
} from 'genlayer-js/types';
export function receiptStatus(receipt: GenLayerTransaction) {
  return (
    receipt.statusName ??
    (typeof receipt.status === 'number'
      ? transactionsStatusNumberToName[
          String(receipt.status) as keyof typeof transactionsStatusNumberToName
        ]
      : receipt.status)
  );
}
export class FinalizedFailure extends Error {}
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
}
