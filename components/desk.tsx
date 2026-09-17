'use client';
import { errorMessage } from '@/lib/errors';
import { filterWorkspace, restoreDrafts } from '@/lib/workspace';
import {
  discoverWallets,
  preferredWallet,
  type WalletOption,
  type WalletSession,
} from '@/lib/wallet';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  HOSTS,
  LABELS,
  formatAmount,
  newDraft,
  parseAmount,
  taskReceiptMarkdown,
  validateCitations,
  validateTask,
  validAddress,
  type AgentRecord,
  type Citation,
  type Task,
} from '@/lib/agenthon';
import {
  listTasks,
  readAgent,
  readTask,
  send,
  track,
  walletClient,
  type ChainConfig,
  type Pending,
} from '@/lib/chain';
import deployment from '@/lib/deployment.json';
import { ConsensusFailure, FinalizedFailure } from '@/lib/receipt';
import { feeUsage, type FeeUsage } from '@/lib/fees';
import { formatGen } from '@genlayer/transaction-kit-react';

const DRAFT_KEY = 'agenthon:drafts:v1',
  PENDING_KEY = 'agenthon:pending:v1';
const initialConfig: ChainConfig = {
  network: deployment.network as ChainConfig['network'],
  contract: deployment.contract,
};
const short = (value: string) =>
  validAddress(value)
    ? `${value.slice(0, 6)}…${value.slice(-4)}`
    : value || 'Not assigned';
const daysLeft = (deadline: number, now: number) =>
  Math.max(0, Math.ceil((deadline - now) / 86400));

/** Deposit, consumed and refunded totals stay separate in the pending panel. */
function feeUsageLine(usage: FeeUsage): string {
  const part = (label: string, value: string | undefined) =>
    value === undefined ? '' : `${label} ${formatGen(BigInt(value))} GEN`;
  return [
    part('Deposit', usage.deposit),
    part('Consumed', usage.consumed),
    part('Refunded', usage.refunded),
  ]
    .filter(Boolean)
    .join(' · ');
}

function Badge({ status }: { status: string }) {
  return <span className={`status ${status}`}>{LABELS[status] ?? status}</span>;
}

function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="message error" role="alert">
      <span>{errorMessage(message)}</span>
    </div>
  );
}

export default function Desk() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [query, setQuery] = useState('');
  const [wallet, setWallet] = useState('');
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(null);
  const [modal, setModal] = useState<'new' | 'submit' | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [record, setRecord] = useState<AgentRecord | null>(null);
  const [more, setMore] = useState(false);
  const [now, setNow] = useState(0);
  const lock = useRef(false);
  const autoConnect = useRef(false);
  const visible = filterWorkspace(tasks, wallet, scope, query);
  const task = visible.find((row) => row.id === selected) ?? visible[0];
  // One network, one contract: the address ships with the app.
  const config = initialConfig;
  const disabled = Boolean(busy);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    // Deferred so restoring the workspace is not a synchronous state update in
    // an effect body; localStorage is the external system here.
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(DRAFT_KEY);
        if (saved) setTasks(restoreDrafts(JSON.parse(saved)));
        const current = localStorage.getItem(PENDING_KEY);
        if (current) {
          const parsed = JSON.parse(current);
          if (
            /^0x[a-fA-F0-9]{64}$/.test(parsed.hash) &&
            ['studioDevnet', 'testnetBradbury'].includes(parsed.config?.network)
          )
            setPending(parsed);
        }
      } catch {
        setError('Saved workspace data could not be read.');
      }
      setReady(true);
      setNow(Math.floor(Date.now() / 1000));
    });
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify(tasks.filter((row) => row.origin === 'draft')),
      );
    } catch {
      /* Drafts stay in memory. */
    }
  }, [tasks, ready]);
  useEffect(() => {
    if (!ready) return;
    try {
      if (pending) localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      else localStorage.removeItem(PENDING_KEY);
    } catch {
      queueMicrotask(() => setError('Could not save the transaction ID.'));
    }
  }, [pending, ready]);
  useEffect(() => {
    let active = true;
    const cleanup = discoverWallets(window, (options) => {
      queueMicrotask(() => {
        if (active) setWalletOptions(options);
      });
    });
    return () => {
      active = false;
      cleanup();
    };
  }, []);
  async function connectWallet(option?: WalletOption) {
    const target = option ?? preferredWallet(walletOptions);
    if (!target) {
      setError(
        'No browser wallet was detected. Install Rabby or MetaMask, enable it for this site, and reload.',
      );
      return;
    }
    await run(`Connecting ${target.name}`, async () => {
      setWallet('');
      const connected = await walletClient(config, target.provider);
      setSelectedWallet(target);
      setWallet(connected.address);
      setNotice(`Connected ${target.name}: ${short(connected.address)}.`);
    });
  }
  function disconnectWallet() {
    setWallet('');
    setSelectedWallet(null);
    setRecord(null);
    setNotice('Wallet disconnected from Agenthon.');
  }
  // Connect as soon as a wallet is detected; a declined request only sets a notice.
  useEffect(() => {
    if (!ready || wallet || autoConnect.current || !walletOptions.length) return;
    const target = preferredWallet(walletOptions);
    if (!target) return;
    autoConnect.current = true;
    queueMicrotask(() => {
      void (async () => {
        setBusy('Connecting wallet');
        try {
          const connected = await walletClient(config, target.provider);
          setSelectedWallet(target);
          setWallet(connected.address);
          setNotice(`Connected ${target.name}: ${short(connected.address)}.`);
        } catch {
          setNotice(
            'Wallet connection was not approved. Use Connect wallet when you are ready.',
          );
        } finally {
          setBusy('');
        }
      })();
    });
  }, [ready, wallet, walletOptions, config]);
  useEffect(() => {
    if (!wallet || !config.contract) {
      queueMicrotask(() => setRecord(null));
      return;
    }
    let active = true;
    void readAgent(config, wallet)
      .then((next) => {
        if (active) setRecord(next);
      })
      .catch(() => {
        if (active) setRecord(null);
      });
    return () => {
      active = false;
    };
  }, [wallet, config]);

  function walletSession(): WalletSession {
    if (!selectedWallet || !wallet)
      throw new Error('Connect your wallet first.');
    return { provider: selectedWallet.provider, address: wallet };
  }
  async function run(label: string, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  function replace(next: Task) {
    setTasks((prev) =>
      prev.some((row) => row.id === next.id && row.origin === 'chain')
        ? prev.map((row) =>
            row.id === next.id && row.origin === 'chain' ? next : row,
          )
        : [...prev.filter((row) => !(row.id === next.id && row.origin === 'draft')), next],
    );
    setSelected(next.id);
  }
  async function refresh(append = false) {
    const offset = append ? tasks.filter((row) => row.origin === 'chain').length : 0;
    const result = await listTasks(config, offset);
    setTasks((prev) => [
      ...prev.filter((row) => row.origin !== 'chain' || append),
      ...result.tasks.filter(
        (row, index, all) =>
          all.findIndex((other) => other.id === row.id) === index &&
          (!append || !prev.some((old) => old.origin === 'chain' && old.id === row.id)),
      ),
    ]);
    setMore(result.hasMore);
    setNotice(
      result.tasks.length
        ? `${result.tasks.length} network tasks loaded.`
        : 'No tasks have been posted to this contract yet.',
    );
  }
  // Read the record back from the contract, so the panel shows what the chain
  // holds rather than what the app hoped it sent.
  async function pull(p: Pending) {
    if (!p.taskId) return;
    const current = await readTask(p.config, p.taskId);
    replace(current);
    if (wallet) setRecord(await readAgent(p.config, wallet).catch(() => null));
  }
  async function complete(p: Pending) {
    let receipt;
    try {
      receipt = await track(p);
    } catch (e) {
      if (e instanceof FinalizedFailure || e instanceof ConsensusFailure) {
        setPending(null);
      }
      // A round validators could not agree on writes nothing, so the call can be
      // sent again; refresh so the panel shows the unchanged record.
      if (e instanceof ConsensusFailure) await pull(p).catch(() => undefined);
      throw e;
    }
    if (p.taskId) {
      await pull(p);
      const used = feeUsage(receipt);
      setNotice(
        used
          ? `Transaction finalized · ${feeUsageLine(used)}`
          : 'Transaction finalized. The record below comes from the contract.',
      );
    }
    setPending(null);
  }
  async function transact(action: string, args: (string | number)[], id: string, value = 0n) {
    if (pending)
      throw new Error('Track the pending transaction before submitting another.');
    const hash = await send(config, walletSession(), action, args, value);
    const p: Pending = { hash, action, taskId: id, config: { ...config } };
    setPending(p);
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    await complete(p);
  }
  async function createTask(form: {
    title: string;
    rubric: string[];
    days: number;
    bounty: string;
  }) {
    const draft = newDraft(form.title, form.rubric, form.days, form.bounty);
    if (!wallet) {
      setTasks((prev) => [...prev, draft]);
      setSelected(draft.id);
      setModal(null);
      setNotice('Draft saved on this device. Connect a wallet to post it.');
      return;
    }
    const next = { ...draft, requester: wallet };
    await transact(
      'create_task',
      [next.id, next.title, JSON.stringify(next.rubric), form.days],
      next.id,
      parseAmount(form.bounty),
    );
  }
  function exportReceipt() {
    if (!task) return;
    const markdown = taskReceiptMarkdown(task, record ?? undefined);
    const url = URL.createObjectURL(
      new Blob([markdown], { type: 'text/markdown' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${task.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const isRequester = Boolean(task && wallet && task.requester === wallet.toLowerCase());
  const isAgent = Boolean(task && wallet && task.agent === wallet.toLowerCase());
  const canAccept =
    Boolean(task) &&
    Boolean(wallet) &&
    !isRequester &&
    (!task!.agent || isAgent) &&
    ['open', 'needs_work'].includes(task!.status);
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Star size={16} />
          </span>
          <div className="brand-text">
            <strong>Agenthon</strong>
            <span>Agent work, graded by consensus</span>
          </div>
        </div>
        <div className="topbar-right">
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(busy)}
            onClick={() => {
              setError('');
              if (wallet) disconnectWallet();
              else void connectWallet();
            }}
          >
            <Wallet />
            {wallet
              ? `${selectedWallet?.name ?? 'Wallet'} · ${short(wallet)}`
              : 'Connect wallet'}
          </Button>
        </div>
      </header>
      <main className="desk">
        <div className="page-heading">
          <div>
            <h1>Agent workbench</h1>
            <p className="lede">
              Post a task with a rubric. An agent delivers. Validators grade the
              work against that rubric, and the score follows the agent to every
              other task.
            </p>
          </div>
          <Button className="primary-action" onClick={() => setModal('new')}>
            <Plus /> New task
          </Button>
        </div>
        <div className="workspace-bar">
          <div>
            <span className="net-dot" />
            <strong>GenLayer Studio Next</strong>
            <span className="bar-divider">·</span>
            <span>Test network · test tokens only</span>
          </div>
          <span className="mono">{config.contract}</span>
        </div>
        {notice && (
          <output className="message notice">
            <span>{notice}</span>
            <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
              ×
            </button>
          </output>
        )}
        <ErrorMessage message={error} />
        {record && (
          <div className="agent-card">
            <div className="card-head">
              <strong>Your agent record</strong>
              <span className={`status ${record.trusted ? 'accepted' : 'open'}`}>
                {record.trusted ? 'Trusted agent' : 'Building a record'}
              </span>
            </div>
            <div className="stat">
              <b>{record.graded}</b>
              <span>Graded</span>
            </div>
            <div className="stat">
              <b>{record.accepted}</b>
              <span>Accepted</span>
            </div>
            <div className="stat">
              <b>{record.average}</b>
              <span>Average</span>
            </div>
            <div className="stat">
              <b>{formatAmount(record.earned_wei)}</b>
              <span>GEN earned</span>
            </div>
            <p className="card-note">
              Every grade is recorded against this address on the contract, so any
              task that reads it sees the same numbers.
            </p>
          </div>
        )}
        {pending && (
          <output className="tx-bar" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <strong>
              Transaction sent · {pending.action.replaceAll('_', ' ')}
            </strong>
            <span className="mono">{short(pending.hash)}</span>
            {busy ? (
              <span className="tx-note">waiting for the network</span>
            ) : (
              <button
                className="text-button"
                onClick={() => run('Checking transaction', () => complete(pending))}
              >
                Check status
              </button>
            )}
          </output>
        )}
        <div className="workbench">
          <aside className="task-rail">
            <div className="rail-head">
              <span className="rail-title">Tasks</span>
              <Tabs
                value={scope}
                onValueChange={(value) => setScope(value as 'mine' | 'all')}
              >
                <TabsList>
                  <TabsTrigger value="mine">Mine</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
            />
            <div className="rail-list">
              {visible.length ? (
                visible.map((row) => (
                  <button
                    key={`${row.origin}:${row.id}`}
                    className={`task-row ${task?.id === row.id ? 'active' : ''}`}
                    onClick={() => setSelected(row.id)}
                  >
                    <span className="row-title">{row.title}</span>
                    <Badge status={row.status} />
                    <span className="row-meta">
                      <span>{formatAmount(row.bounty_wei)} GEN</span>
                      <span>· {daysLeft(row.deadline, now)}d left</span>
                      {row.grade && (
                        <span className="score-chip">{row.score}/100</span>
                      )}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rail-empty">
                  No tasks yet. Create one, or load the records already on the
                  contract.
                </div>
              )}
            </div>
            <div className="rail-actions">
              <Button
                variant="outline"
                size="sm"
                className="load-briefs"
                disabled={disabled}
                onClick={() => void run('Loading network tasks', () => refresh(more))}
              >
                <RefreshCw /> {more ? 'Load more' : 'Load network tasks'}
              </Button>
            </div>
          </aside>
          <section className="case">
            {!task ? (
              <div className="empty-state">
                Select a task on the left, or create one to commission agent
                work.
              </div>
            ) : (
              <>
                <div className="case-topline">
                  <span className="eyebrow">
                    {task.origin === 'draft' ? 'Local draft' : 'Contract record'}
                  </span>
                  <Badge status={task.status} />
                </div>
                <div className="case-title-row">
                  <h2>{task.title}</h2>
                </div>
                <div className="case-meta">
                  <span>
                    Requester <b>{short(task.requester)}</b>
                  </span>
                  <span>
                    Agent <b>{short(task.agent)}</b>
                  </span>
                  <span>
                    Budget <b>{formatAmount(task.bounty_wei)} GEN</b>
                  </span>
                  <span>
                    <b>{daysLeft(task.deadline, now)}</b> days left
                  </span>
                  <span>
                    Delivery <b>{task.revision}</b>
                  </span>
                </div>
                {task.grade && (
                  <div className="score-card">
                    <div className="score-value">
                      {task.score}
                      <small>/100</small>
                    </div>
                    <div className="score-caption">
                      <strong>{LABELS[task.grade.decision]}</strong>
                      <span>
                        Graded by GenLayer validators against this rubric. The
                        score is recorded against {short(task.agent)}.
                      </span>
                      <div className="score-bar">
                        <i style={{ width: `${Math.max(2, task.score)}%` }} />
                      </div>
                    </div>
                  </div>
                )}
                <div className="section">
                  <div className="section-label">Rubric</div>
                  <ol className="rubric">
                    {task.rubric.map((row, index) => {
                      const graded = task.grade?.criteria.find(
                        (c) => c.index === index,
                      );
                      return (
                        <li key={row} className="rubric-item">
                          <span className="rubric-index">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span>{row}</span>
                          {graded ? (
                            <Badge status={graded.band} />
                          ) : (
                            <span className="status unsupported">Awaiting grade</span>
                          )}
                          {graded && (
                            <span className="rubric-reason">{graded.reason}</span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
                {task.submission && (
                  <div className="section">
                    <div className="section-label">Delivered summary</div>
                    <p className="deliverable">{task.submission.summary}</p>
                  </div>
                )}
                {Boolean(task.submission?.claims.length) && (
                  <div className="section">
                    <div className="section-label">Citations</div>
                    <ul className="citations">
                      {task.submission?.claims.map((citation, index) => {
                        const result = task.grade?.citations[index];
                        return (
                          <li key={citation.text} className="citation">
                            <div className="citation-head">
                              <span>{citation.text}</span>
                              {result && <Badge status={result.verdict} />}
                            </div>
                            <a
                              className="citation-src"
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {citation.url}
                            </a>
                            {result?.quote && (
                              <blockquote className="quote">{result.quote}</blockquote>
                            )}
                            {result?.reason && (
                              <p className="rubric-reason">{result.reason}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="case-actions">
                  {canAccept && (
                    <Button
                      disabled={disabled}
                      onClick={() =>
                        run('Accepting task', () =>
                          transact('accept_task', [task.id], task.id),
                        )
                      }
                    >
                      <Check /> Accept task
                    </Button>
                  )}
                  {['working', 'needs_work', 'rejected'].includes(task.status) &&
                    isAgent && (
                      <Button
                        className="primary-action"
                        disabled={disabled}
                        onClick={() => setModal('submit')}
                      >
                        Submit deliverable
                      </Button>
                    )}
                  {task.status === 'grading' && (isRequester || isAgent) && (
                    <Button
                      className="primary-action"
                      disabled={disabled}
                      onClick={() =>
                        run('Grading delivery', () =>
                          transact('grade_deliverable', [task.id], task.id),
                        )
                      }
                    >
                      Grade delivery
                    </Button>
                  )}
                  {task.status === 'accepted' && isAgent && (
                    <Button
                      className="primary-action"
                      disabled={disabled}
                      onClick={() =>
                        run('Claiming payout', () =>
                          transact('claim_payout', [task.id], task.id),
                        )
                      }
                    >
                      Claim payout
                    </Button>
                  )}
                  {isRequester &&
                    ['open', 'working', 'grading', 'rejected', 'needs_work'].includes(
                      task.status,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          run('Refunding', () =>
                            transact('refund_expired', [task.id], task.id),
                          )
                        }
                      >
                        Refund when expired
                      </Button>
                    )}
                  <Button variant="ghost" onClick={exportReceipt}>
                    Export report <ArrowDownToLine />
                  </Button>
                  {task.origin === 'draft' && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setTasks((prev) =>
                          prev.filter((row) => row.id !== task.id),
                        )
                      }
                    >
                      <Trash2 /> Discard draft
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
        <footer className="desk-footer">
          <span>Agenthon · agent work with portable reputation</span>
          <span>
            Graded by GenLayer validators · the score belongs to the contract,
            not to a platform
          </span>
        </footer>
      </main>
      <Dialog open={modal === 'new'} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent className="desk-dialog">
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
            <DialogDescription>
              A rubric lets any validator grade the same delivery the same way.
            </DialogDescription>
          </DialogHeader>
          <TaskForm
            wallet={wallet}
            disabled={Boolean(busy)}
            onSave={(form) =>
              run('Posting task', async () => {
                await createTask(form);
                setModal(null);
              })
            }
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === 'submit'}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent className="desk-dialog">
          <DialogHeader>
            <DialogTitle>Submit deliverable</DialogTitle>
            <DialogDescription>
              A summary and up to three citations. Validators fetch the sources
              themselves.
            </DialogDescription>
          </DialogHeader>
          <DeliveryForm
            disabled={Boolean(busy)}
            onSave={(summary, claims) =>
              run('Submitting delivery', async () => {
                if (!task) return;
                await transact(
                  'submit_deliverable',
                  [task.id, summary, JSON.stringify(claims)],
                  task.id,
                );
                setModal(null);
              })
            }
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function TaskForm({
  wallet,
  disabled,
  onSave,
}: {
  wallet: string;
  disabled: boolean;
  onSave: (form: { title: string; rubric: string[]; days: number; bounty: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [rubric, setRubric] = useState('');
  const [days, setDays] = useState(7);
  const [bounty, setBounty] = useState('0');
  const [error, setError] = useState('');
  return (
    <div className="desk-form">
      <label htmlFor="task-title">
        Title
        <Input
          id="task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Explain what useState returns"
          maxLength={160}
        />
      </label>
      <label htmlFor="task-rubric">
        Rubric, one criterion per line (1–4)
        <Textarea
          id="task-rubric"
          value={rubric}
          onChange={(e) => setRubric(e.target.value)}
          rows={4}
          placeholder={'State what useState returns.\nCite the official React docs.'}
        />
      </label>
      <label htmlFor="task-days">
        Days until the deadline
        <Input
          id="task-days"
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <label htmlFor="task-bounty">
        Budget in GEN (0 keeps funded gating out of the demo)
        <Input
          id="task-bounty"
          value={bounty}
          onChange={(e) => setBounty(e.target.value)}
          inputMode="decimal"
        />
      </label>
      <ErrorMessage message={error} />
      <p className="help-text">
        {wallet
          ? 'Posting sends a transaction from your connected wallet.'
          : 'Saved as a device-local draft until you connect a wallet.'}
      </p>
      <Button
        disabled={disabled}
        onClick={() => {
          const criteria = rubric.split('\n').map((row) => row.trim()).filter(Boolean);
          try {
            validateTask(title, criteria, days);
            parseAmount(bounty);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return;
          }
          onSave({ title, rubric: criteria, days, bounty });
        }}
      >
        {wallet ? 'Post task to GenLayer' : 'Save draft'}
      </Button>
    </div>
  );
}

function DeliveryForm({
  disabled,
  onSave,
}: {
  disabled: boolean;
  onSave: (summary: string, claims: Citation[]) => void;
}) {
  const [summary, setSummary] = useState('');
  const [claims, setClaims] = useState<Citation[]>([{ text: '', url: '' }]);
  const [error, setError] = useState('');
  const update = (index: number, patch: Partial<Citation>) =>
    setClaims((prev) =>
      prev.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
  return (
    <div className="desk-form">
      <label htmlFor="delivery-summary">
        Deliverable summary (20–2000 characters)
        <Textarea
          id="delivery-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={6}
          placeholder="useState returns an array with exactly two values: the current state and its set function."
        />
      </label>
      {claims.map((claim, index) => (
        <fieldset key={index}>
          <label htmlFor={`citation-${index}`}>
            Citation {index + 1}
            <Input
              id={`citation-${index}`}
              value={claim.text}
              onChange={(e) => update(index, { text: e.target.value })}
              placeholder="A sentence the source states"
              maxLength={400}
            />
          </label>
          <label htmlFor={`citation-url-${index}`}>
            Source
            <select
              id={`citation-url-${index}`}
              value={claim.url}
              onChange={(e) => update(index, { url: e.target.value })}
            >
              <option value="">Choose an approved documentation host…</option>
              {HOSTS.map((host) => (
                <option key={host} value={`https://${host}/`}>
                  {host}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`citation-path-${index}`}>
            Path on that host
            <Input
              id={`citation-path-${index}`}
              value={claim.url.replace(/^https:\/\/[^/]+/, '')}
              onChange={(e) =>
                update(index, {
                  url: `${claim.url.replace(/(^https:\/\/[^/]+).*/, '$1')}${e.target.value}`,
                })
              }
              placeholder="/reference/react/useState"
            />
          </label>
        </fieldset>
      ))}
      <div className="dialog-actions">
        {claims.length > 1 && (
          <Button variant="ghost" onClick={() => setClaims((prev) => prev.slice(0, -1))}>
            Remove last
          </Button>
        )}
        {claims.length < 3 && (
          <Button
            variant="ghost"
            onClick={() => setClaims((prev) => [...prev, { text: '', url: '' }])}
          >
            Add citation
          </Button>
        )}
      </div>
      <ErrorMessage message={error} />
      <Button
        disabled={disabled}
        onClick={() => {
          try {
            if (summary.trim().length < 20 || summary.trim().length > 2000)
              throw new Error('Write 20 to 2000 characters.');
            const complete = claims.filter((row) => row.text.trim() && row.url.trim());
            validateCitations(complete);
            onSave(summary.trim(), complete);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Submit deliverable
      </Button>
    </div>
  );
}
