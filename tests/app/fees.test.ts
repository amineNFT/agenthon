import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioDevnet, testnetBradbury } from 'genlayer-js/chains';
import {
  feeSuggestions,
  feeUsage,
  findFeeAccounting,
  profileEntry,
  profileMatchesChain,
  suggestionsFor,
  STUDIO_NEXT_CHAIN_ID,
} from '../../lib/fees.ts';

void test('the committed fee profile targets Studio Next only', () => {
  assert.equal(STUDIO_NEXT_CHAIN_ID, 61997);
  assert.equal(studioDevnet.id, STUDIO_NEXT_CHAIN_ID);
  assert.equal(profileMatchesChain(studioDevnet.id), true);
  // A profile measured on 61997 must never be applied to another chain's fees.
  assert.equal(profileMatchesChain(testnetBradbury.id), false);
  assert.equal(profileMatchesChain(61999), false);
});

void test('unmeasured methods never claim a developer fee profile', () => {
  const write = {
    kind: 'write' as const,
    address: '0x1111111111111111111111111111111111111111' as const,
    method: 'create_brief',
    args: [],
  };
  const deploy = { kind: 'deploy' as const, code: '' };
  // The committed profile carries no measurements yet, so both fall back to
  // network defaults instead of being labelled as measured.
  assert.equal(profileEntry(write), undefined);
  assert.equal(profileEntry(deploy), undefined);
  assert.equal(suggestionsFor(write), undefined);
  assert.equal(suggestionsFor(deploy), undefined);
  assert.deepEqual(Object.keys(feeSuggestions.methods ?? {}), []);
});

void test('fee accounting keeps deposit, consumption and refund apart', () => {
  const receipt = {
    consensus_data: {
      leader_receipt: [
        {
          mode: 'leader',
          feeAccounting: {
            paid_fee_value: '1000',
            primary_fee_spent: '250',
            total_refunded: '750',
            required_fee_value: '1000',
          },
        },
      ],
    },
  };
  assert.deepEqual(findFeeAccounting(receipt), {
    paid_fee_value: '1000',
    primary_fee_spent: '250',
    total_refunded: '750',
    required_fee_value: '1000',
  });
  assert.deepEqual(feeUsage(receipt), {
    deposit: '1000',
    consumed: '250',
    refunded: '750',
  });
});

void test('a receipt without fee accounting reports nothing', () => {
  assert.equal(findFeeAccounting({ status: 'FINALIZED' }), undefined);
  assert.equal(feeUsage({ status: 'FINALIZED', data: {} }), undefined);
  assert.equal(feeUsage(null), undefined);
  // Zero-valued bigints are still a real observation and stay reportable.
  assert.deepEqual(feeUsage({ feeAccounting: { paid_fee_value: 0n } }), {
    deposit: '0',
    consumed: undefined,
    refunded: undefined,
  });
});
