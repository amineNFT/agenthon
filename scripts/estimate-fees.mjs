/**
 * Quotes fees for a deploy and for every Agenthon write against the network
 * in lib/deployment.json (Studio Next by default).
 *
 * Read-only: it signs nothing, sends nothing, and needs no funded account, so
 * it is the quickest way to confirm the fee path works before spending GEN.
 * Run with: npm run estimate-fees
 */
import { readFile } from 'node:fs/promises';
import { studioDevnet } from 'genlayer-js/chains';
import { describeFee, quote } from './fees.mjs';

const deployment = JSON.parse(await readFile('lib/deployment.json', 'utf8'));
const chain = studioDevnet;
const contract = deployment.contract || '0x0000000000000000000000000000000000000000';
if (!deployment.contract)
  console.log('No contract address in lib/deployment.json; quoting writes against the zero address.');

const transactions = [
  { kind: 'deploy', code: '', args: [], leaderOnly: false },
  {
    kind: 'write',
    address: contract,
    method: 'create_task',
    args: ['estimate-probe', 'Fee probe', '["One criterion for the probe."]', 7],
  },
  { kind: 'write', address: contract, method: 'accept_task', args: ['estimate-probe'] },
  { kind: 'write', address: contract, method: 'submit_deliverable', args: ['estimate-probe', 'A deliverable summary for the probe.', '[]'] },
  { kind: 'write', address: contract, method: 'grade_deliverable', args: ['estimate-probe'] },
  { kind: 'write', address: contract, method: 'claim_payout', args: ['estimate-probe'] },
  { kind: 'write', address: contract, method: 'refund_expired', args: ['estimate-probe'] },
];

console.log(`Network: ${chain.name} (chain ${chain.id}) · ${chain.rpcUrls.default.http[0]}`);
for (const tx of transactions) {
  try {
    const { estimate } = await quote(chain, tx);
    const label = tx.kind === 'deploy' ? 'deploy' : tx.method;
    console.log(`${label.padEnd(16)} ${describeFee(estimate)}`);
  } catch (error) {
    const label = tx.kind === 'deploy' ? 'deploy' : tx.method;
    console.log(`${label.padEnd(16)} estimate failed: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
