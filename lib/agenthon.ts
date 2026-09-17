export type Citation = { text: string; url: string };
export type CitationResult = {
  verdict: 'supported' | 'contradicted' | 'unsupported';
  quote: string;
  reason: string;
};
export type CriterionGrade = {
  index: number;
  criterion: string;
  band: 'met' | 'partial' | 'unmet';
  reason: string;
};
export type Grade = {
  criteria: CriterionGrade[];
  citations: CitationResult[];
  decision: 'accepted' | 'needs_work' | 'rejected';
  score: number;
};
export type AgentRecord = {
  graded: number;
  accepted: number;
  score_sum: number;
  average: number;
  earned_wei: string;
  trusted: boolean;
  restricted: boolean;
};
export type TaskStatus =
  | 'open'
  | 'working'
  | 'grading'
  | 'accepted'
  | 'needs_work'
  | 'rejected'
  | 'paid'
  | 'refunded';
export type Submission = { summary: string; claims: Citation[] };
export type Task = {
  id: string;
  title: string;
  rubric: string[];
  requester: string;
  agent: string;
  bounty_wei: string;
  created_at: number;
  deadline: number;
  revision: number;
  status: TaskStatus;
  submission: Submission | null;
  grade: Grade | null;
  score: number;
  paid: boolean;
  origin: 'draft' | 'chain';
};
export const HOSTS = [
  'developer.mozilla.org',
  'react.dev',
  'docs.python.org',
  'docs.genlayer.com',
  'nodejs.org',
  'nextjs.org',
  'www.typescriptlang.org',
  'redis.io',
  'docs.docker.com',
  'kubernetes.io',
  'docs.github.com',
  'fastapi.tiangolo.com',
  'docs.pydantic.dev',
  'www.rust-lang.org',
  'www.sqlite.org',
  'sqlite.org',
  'www.postgresql.org',
  'postgresql.org',
  'duckdb.org',
];
export const LABELS: Record<string, string> = {
  open: 'Open for an agent',
  working: 'Claimed by an agent',
  grading: 'Awaiting grading',
  accepted: 'Accepted',
  needs_work: 'Needs work',
  rejected: 'Rejected',
  paid: 'Paid',
  refunded: 'Refunded',
  supported: 'Supported',
  contradicted: 'Contradicted',
  unsupported: 'Not supported',
  met: 'Met',
  partial: 'Partial',
  unmet: 'Unmet',
};
// Mirrors the contract: funded work requires a proven record.
export const FUNDED_MIN_GRADED = 1;
export const FUNDED_MIN_AVERAGE = 70;
export const RESTRICTED_AVERAGE = 50;
export const TRUSTED_MIN_GRADED = 3;
export const TRUSTED_MIN_AVERAGE = 80;

export function validAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
}
export function validateCitation(citation: Citation): string | null {
  if (
    typeof citation?.text !== 'string' ||
    citation.text.trim().length < 10 ||
    citation.text.trim().length > 400
  )
    return 'Each citation needs 10 to 400 characters.';
  if (typeof citation?.url !== 'string' || citation.url.length > 500)
    return 'Add a source URL of at most 500 characters.';
  const match = /^https:\/\/([a-z0-9.-]+)(\/[^\s?#\\]*)?$/.exec(citation.url);
  if (!match || !HOSTS.includes(match[1]))
    return 'Use an approved HTTPS documentation URL without a query or fragment.';
  return null;
}
export function validateCitations(citations: Citation[]) {
  if (!Array.isArray(citations) || citations.length > 3)
    throw new Error('Include at most 3 citations.');
  for (const citation of citations) {
    const error = validateCitation(citation);
    if (error) throw new Error(error);
  }
  if (
    new Set(citations.map((c) => c.text.trim().toLowerCase())).size !==
    citations.length
  )
    throw new Error('Remove duplicate citations.');
  return citations.map((c) => ({ text: c.text.trim(), url: c.url.trim() }));
}
export function validateTask(title: string, rubric: string[], days: number) {
  if (title.trim().length < 8 || title.trim().length > 160)
    throw new Error('Use a title of 8 to 160 characters.');
  const clean = rubric.map((row) => row.trim()).filter(Boolean);
  if (
    clean.length < 1 ||
    clean.length > 4 ||
    clean.some((row) => row.length < 8 || row.length > 200)
  )
    throw new Error('Add 1 to 4 rubric criteria, each 8 to 200 characters.');
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error('Choose a deadline between 1 and 30 days.');
}
export function parseAmount(amount: string): bigint {
  if (!/^\d{1,8}(\.\d{1,18})?$/.test(amount))
    throw new Error(
      'Enter a nonnegative amount with at most 18 decimal places.',
    );
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}
export function formatAmount(wei: string) {
  const n = BigInt(wei);
  const f = (n % 10n ** 18n)
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '');
  return `${n / 10n ** 18n}${f ? '.' + f : ''}`;
}
/** Whether an agent may take funded work, mirrors the contract's gate. */
export function fundedEligibility(record: AgentRecord) {
  if (record.restricted)
    return 'Reputation too low for funded work: raise the average above 50.';
  if (
    record.graded < FUNDED_MIN_GRADED ||
    record.average < FUNDED_MIN_AVERAGE
  )
    return 'Funded work needs a proven record: one graded delivery at 70 or above.';
  return null;
}
export function newDraft(
  title: string,
  rubric: string[],
  days: number,
  bounty: string,
): Task {
  validateTask(title, rubric, days);
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `ag-${crypto.randomUUID()}`,
    title: title.trim(),
    rubric: rubric.map((row) => row.trim()).filter(Boolean),
    requester: '',
    agent: '',
    bounty_wei: parseAmount(bounty).toString(),
    created_at: now,
    deadline: now + days * 86400,
    revision: 0,
    status: 'open',
    submission: null,
    grade: null,
    score: 0,
    paid: false,
    origin: 'draft',
  };
}
export function taskReceiptMarkdown(task: Task, record?: AgentRecord) {
  const lines = [
    `# ${task.title}`,
    '',
    `Task: ${task.id}`,
    `Mode: ${task.origin === 'draft' ? 'Local draft' : 'GenLayer contract record'}`,
    `Status: ${LABELS[task.status]}`,
    `Deliveries: ${task.revision}`,
    `Budget: ${formatAmount(task.bounty_wei)} GEN`,
    '',
    '## Rubric',
    ...task.rubric.map((row, i) => `${i + 1}. ${row}`),
    '',
    '## Grade',
    `Decision: ${LABELS[task.grade?.decision ?? task.status]}`,
    `Score: ${task.score}/100`,
  ];
  for (const criterion of task.grade?.criteria ?? []) {
    lines.push(
      '',
      `### ${criterion.index + 1}. ${criterion.criterion}`,
      `Band: ${LABELS[criterion.band]}`,
      criterion.reason,
    );
  }
  if (task.grade?.citations.length) {
    lines.push('', '## Citations');
    task.grade.citations.forEach((result, i) => {
      const citation = task.submission?.claims[i];
      lines.push(
        '',
        `### ${i + 1}. ${citation?.text ?? 'Citation'}`,
        `Source: ${citation?.url ?? 'unknown'}`,
        `Verdict: ${LABELS[result.verdict]}`,
        ...(result.quote ? [`> ${result.quote}`] : []),
        result.reason,
      );
    });
  }
  if (task.submission)
    lines.push('', '## Delivered summary', task.submission.summary);
  if (record) {
    lines.push(
      '',
      '## Agent reputation',
      `Graded deliveries: ${record.graded}`,
      `Accepted: ${record.accepted}`,
      `Average score: ${record.average}`,
      `Earned: ${formatAmount(record.earned_wei)} GEN`,
      `Trusted: ${record.trusted ? 'yes' : 'no'}`,
    );
  }
  return lines.join('\n');
}
