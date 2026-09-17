import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSuccess,
  consensusOutcome,
  ConsensusFailure,
  FinalizedFailure,
  receiptStatus,
} from '../../lib/receipt.ts';

// Shaped like a real Studio Next receipt: snake_case status, the GenVM result
// next to the consensus verdict.
const finalized = {
  hash: '0xabc',
  status_name: 'FINALIZED',
  txExecutionResultName: 'FINISHED_WITH_RETURN',
  lifecycle: { state: 'finalized', outcome: 'accepted' },
  result_name: 'MAJORITY_AGREE',
};

void test('an accepted round is a success', () => {
  assert.doesNotThrow(() => assertSuccess(finalized as never));
});

void test('status is read from the snake_case field the chain returns', () => {
  assert.equal(receiptStatus({ status_name: 'FINALIZED' } as never), 'FINALIZED');
});

void test('a clean execution with an undetermined round is not reported as done', () => {
  // The failure that showed nothing in the UI: GenVM succeeded, so only the
  // consensus verdict reveals that the contract wrote no state.
  assert.throws(
    () =>
      assertSuccess({
        ...finalized,
        lifecycle: { state: 'finalized', outcome: 'undetermined' },
        result_name: 'MAJORITY_DISAGREE',
      } as never),
    ConsensusFailure,
  );
});

void test('an unagreed round is detected from the result name alone', () => {
  // Older receipts carry no lifecycle block, only the round verdict.
  const bare = {
    hash: '0xabc',
    status_name: 'FINALIZED',
    txExecutionResultName: 'FINISHED_WITH_RETURN',
  };
  assert.throws(
    () =>
      assertSuccess({ ...bare, result_name: 'MAJORITY_DISAGREE' } as never),
    ConsensusFailure,
  );
  assert.doesNotThrow(() =>
    assertSuccess({ ...bare, result_name: 'MAJORITY_AGREE' } as never),
  );
  assert.equal(consensusOutcome({ result_name: 'MAJORITY_AGREE' } as never), 'accepted');
  assert.equal(
    consensusOutcome({ result_name: 'MAJORITY_DISAGREE' } as never),
    'undetermined',
  );
});

void test('a failed execution is still reported as a failed execution', () => {
  assert.throws(
    () =>
      assertSuccess({ ...finalized, txExecutionResultName: 'FINISHED_WITH_ERROR' } as never),
    FinalizedFailure,
  );
});

void test('an unfinalized transaction is not treated as complete', () => {
  assert.throws(
    () => assertSuccess({ ...finalized, status_name: 'PENDING' } as never),
    /pending/i,
  );
});

void test('a receipt with no consensus data keeps its execution verdict', () => {
  assert.doesNotThrow(() =>
    assertSuccess({
      status_name: 'FINALIZED',
      consensus_data: { leader_receipt: [{ mode: 'leader', execution_result: 'SUCCESS' }] },
    } as never),
  );
});
