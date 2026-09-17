/**
 * Read-only state dump for a deployed Agenthon contract.
 *
 * Prints every task (or one task plus its reviewed revisions) so contract
 * state can be compared with what the app shows. Signs nothing, sends nothing.
 *
 * Usage: node scripts/inspect-task.mjs [taskId]
 */
import { readFile } from 'node:fs/promises';
import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

const deployment = JSON.parse(await readFile('lib/deployment.json', 'utf8'));
const address = process.env.CONTRACT || deployment.contract;
if (!address) throw new Error('No contract address in lib/deployment.json.');
const client = createClient({ chain: studioDevnet });
const read = (functionName, args = []) =>
  client.readContract({
    address,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });

console.log(`Contract ${address} · ${studioDevnet.name} (chain ${studioDevnet.id})`);
console.log(`Version: ${await read('get_version')}`);

const ids = await read('list_tasks', [0, 30]);
console.log(`Tasks (${ids.length}): ${ids.join(', ') || '(none)'}\n`);

const wanted = process.argv[2] ? [process.argv[2]] : ids;
for (const id of wanted) {
  let task;
  try {
    task = JSON.parse(await read('get_task', [id]));
  } catch (error) {
    console.log(`${id}: unreadable (${error?.message ?? error})`);
    continue;
  }
  console.log(`=== ${id} — "${task.title}"`);
  console.log(`status=${task.status} revision=${task.revision} paid=${task.paid}`);
  console.log(`owner=${task.owner} researcher=${task.researcher}`);
  console.log(`deadline=${new Date(task.deadline * 1000).toISOString()}`);
  console.log(`criteria=${JSON.stringify(task.requirements)}`);
  for (const [i, claim] of (task.claims ?? []).entries()) {
    console.log(`claim[${i}] ${claim.text}\n          ${claim.url}`);
  }
  console.log(`review=${task.review ? JSON.stringify(task.review, null, 2) : 'none'}`);
  // Grades are recorded under "<id>:<revision>".
  for (let revision = 1; revision <= task.revision; revision += 1) {
    try {
      const snapshot = { status: task.status };
      console.log(
        `revision ${revision}: status=${snapshot.status} decision=${snapshot.review?.decision ?? 'none'}`,
      );
    } catch {
      console.log(`revision ${revision}: not recorded`);
    }
  }
  console.log('');
}
