import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAmount,
  fundedEligibility,
  newDraft,
  parseAmount,
  taskReceiptMarkdown,
  validateCitations,
  validateTask,
  validAddress,
  type AgentRecord,
  type Task,
} from '../../lib/agenthon.ts';
import { filterWorkspace, restoreDrafts } from '../../lib/workspace.ts';

const react = 'https://react.dev/reference/react/useState';

void test('task bounds match the contract', () => {
  assert.throws(() => validateTask('short', ['A criterion of length.'], 7), /8 to 160/);
  assert.throws(
    () => validateTask('A title long enough', [], 7),
    /1 to 4 rubric criteria/,
  );
  assert.throws(
    () => validateTask('A title long enough', ['tiny'], 7),
    /1 to 4 rubric criteria/,
  );
  assert.throws(
    () => validateTask('A title long enough', ['A criterion of length.'], 90),
    /1 and 30 days/,
  );
  validateTask('A title long enough', ['A criterion of length.'], 7);
});

void test('citations stay inside the approved documentation hosts', () => {
  assert.throws(
    () =>
      validateCitations([
        { text: 'A citation that looks plausible.', url: 'https://react.dev/x?y=1' },
      ]),
    /without a query or fragment/,
  );
  assert.throws(
    () =>
      validateCitations([
        { text: 'A citation that looks plausible.', url: 'https://evil.example.com/x' },
      ]),
    /approved HTTPS documentation URL/,
  );
  assert.deepEqual(
    validateCitations([{ text: '  useState returns two values.  ', url: react }]),
    [{ text: 'useState returns two values.', url: react }],
  );
  assert.throws(
    () =>
      validateCitations([
        { text: 'The same citation twice over.', url: react },
        { text: 'The same citation twice over.', url: react },
      ]),
    /duplicate/,
  );
});

void test('amounts round-trip at full precision', () => {
  assert.equal(parseAmount('0'), 0n);
  assert.equal(parseAmount('1.5'), 1500000000000000000n);
  assert.equal(formatAmount(parseAmount('1.5').toString()), '1.5');
  assert.equal(formatAmount(parseAmount('0').toString()), '0');
  assert.throws(() => parseAmount('-1'), /nonnegative/);
  assert.throws(() => parseAmount('1e18'), /nonnegative/);
});

void test('a draft is a valid, unsigned task', () => {
  const draft = newDraft('Explain React state', ['State what useState returns.'], 7, '0');
  assert.equal(draft.origin, 'draft');
  assert.match(draft.id, /^ag-/);
  assert.equal(draft.status, 'open');
  assert.equal(draft.bounty_wei, '0');
  assert.equal(draft.deadline - draft.created_at, 7 * 86400);
});

void test('funded work is gated on a proven record', () => {
  const fresh: AgentRecord = {
    graded: 0, accepted: 0, score_sum: 0, average: 0,
    earned_wei: '0', trusted: false, restricted: false,
  };
  assert.match(fundedEligibility(fresh) ?? '', /proven record/);
  const proven: AgentRecord = { ...fresh, graded: 1, accepted: 1, score_sum: 90, average: 90 };
  assert.equal(fundedEligibility(proven), null);
  const restricted: AgentRecord = { ...proven, graded: 3, average: 40, restricted: true };
  assert.match(fundedEligibility(restricted) ?? '', /too low/);
});

void test('the receipt reports the grade, citations and reputation', () => {
  const task: Task = {
    ...newDraft('Explain React state', ['State what useState returns.'], 7, '0'),
    origin: 'chain',
    requester: '0x1111111111111111111111111111111111111111',
    agent: '0x2222222222222222222222222222222222222222',
    status: 'accepted',
    revision: 1,
    score: 80,
    submission: { summary: 'useState returns two values.', claims: [{ text: 'A cited statement.', url: react }] },
    grade: {
      decision: 'needs_work',
      score: 80,
      criteria: [{ index: 0, criterion: 'State what useState returns.', band: 'partial', reason: 'Half right.' }],
      citations: [{ verdict: 'supported', quote: 'useState is a React Hook', reason: 'Stated.' }],
    },
  };
  const markdown = taskReceiptMarkdown(task, {
    graded: 2, accepted: 1, score_sum: 160, average: 80, earned_wei: '0', trusted: false, restricted: false,
  });
  assert.match(markdown, /Score: 80\/100/);
  assert.match(markdown, /Band: Partial/);
  assert.match(markdown, /Verdict: Supported/);
  assert.match(markdown, /Average score: 80/);
  assert.match(markdown, /useState returns two values\./);
});

void test('the workspace filter shows my work, drafts and matches', () => {
  const base = newDraft('Explain React state', ['State what useState returns.'], 7, '0');
  const mine: Task = { ...base, id: 'ag-mine', origin: 'chain', requester: '0xAbC0000000000000000000000000000000000001' };
  const theirs: Task = { ...base, id: 'ag-theirs', origin: 'chain', agent: '0x9999999999999999999999999999999999999999' };
  const draft: Task = { ...base, id: 'ag-draft' };
  const wallet = '0xabc0000000000000000000000000000000000001';
  assert.deepEqual(
    filterWorkspace([mine, theirs, draft], wallet, 'mine', '').map((t) => t.id),
    ['ag-mine', 'ag-draft'],
  );
  assert.equal(filterWorkspace([mine, theirs, draft], wallet, 'all', '').length, 3);
  assert.deepEqual(
    filterWorkspace([mine, theirs], wallet, 'all', 'react').map((t) => t.id),
    ['ag-mine', 'ag-theirs'],
  );
  assert.equal(filterWorkspace([mine], wallet, 'all', 'nothing').length, 0);
});

void test('malformed drafts are dropped instead of restored', () => {
  const good = newDraft('Explain React state', ['State what useState returns.'], 7, '0');
  assert.equal(restoreDrafts([good]).length, 1);
  assert.equal(restoreDrafts([{ ...good, bounty_wei: 'x' }]).length, 0);
  assert.equal(restoreDrafts([{ ...good, deadline: good.created_at - 1 }]).length, 0);
  assert.equal(restoreDrafts([{ ...good, rubric: [] }]).length, 0);
  assert.equal(restoreDrafts('not an array').length, 0);
  assert.equal(validAddress('0x0000000000000000000000000000000000000000'), false);
  assert.equal(validAddress('0x1111111111111111111111111111111111111111'), true);
});
