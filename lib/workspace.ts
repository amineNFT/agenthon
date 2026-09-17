import { validateCitations, validateTask, type Task } from './agenthon.ts';

export function filterWorkspace(
  tasks: Task[],
  wallet: string,
  scope: 'mine' | 'all',
  query: string,
): Task[] {
  const account = wallet.toLowerCase();
  const text = query.trim().toLowerCase();
  return tasks.filter(
    (task) =>
      (scope === 'all' ||
        task.origin === 'draft' ||
        (account &&
          [task.requester, task.agent].some(
            (address) => address.toLowerCase() === account,
          ))) &&
      task.title.toLowerCase().includes(text),
  );
}

export function restoreDrafts(value: unknown): Task[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    try {
      if (
        !raw ||
        raw.origin !== 'draft' ||
        typeof raw.id !== 'string' ||
        !Array.isArray(raw.rubric) ||
        typeof raw.bounty_wei !== 'string' ||
        !/^\d{1,26}$/.test(raw.bounty_wei) ||
        !Number.isFinite(raw.created_at) ||
        !Number.isFinite(raw.deadline) ||
        raw.deadline <= raw.created_at
      )
        return [];
      validateTask(
        raw.title,
        raw.rubric,
        Math.ceil((raw.deadline - raw.created_at) / 86400),
      );
      const claims = raw.submission?.claims?.length
        ? validateCitations(raw.submission.claims)
        : [];
      return [
        {
          ...raw,
          submission: raw.submission
            ? { summary: String(raw.submission.summary ?? ''), claims }
            : null,
          grade: null,
          status: 'open',
          score: 0,
          revision: 0,
          paid: false,
        } as Task,
      ];
    } catch {
      return [];
    }
  });
}
