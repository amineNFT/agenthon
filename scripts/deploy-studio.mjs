import { createClient, createAccount, generatePrivateKey } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { describeFee, quote } from './fees.mjs';
await mkdir('.keys', { recursive: true });
await mkdir('artifacts', { recursive: true });
let key;
try {
  key = (await readFile('.keys/studio.key', 'utf8')).trim();
} catch {
  key = generatePrivateKey();
  await writeFile('.keys/studio.key', key, { mode: 0o600 });
}
const account = createAccount(key);
const client = createClient({ chain: studioDevnet, account });
console.log(`Studio Next test account: ${account.address}`);
console.log(`RPC chain ID: ${await client.getChainId()}`);
const code = await readFile('contracts/agenthon.py');
console.log('Validating contract schema...');
const schema = await client.getContractSchemaForCode(new Uint8Array(code));
await writeFile(
  'artifacts/contract-schema.json',
  JSON.stringify(schema, null, 2),
);
console.log('Contract schema validated.');
let pending;
try {
  pending = JSON.parse(await readFile('.keys/deploy-state.json', 'utf8'));
} catch {}
if (!pending) {
  const { estimate, feeArgs } = await quote(studioDevnet, {
    kind: 'deploy',
    // Fee estimation reads the live policy; it does not compile the contract,
    // so the source itself is sent with the real deploy below.
    code: '',
    args: [],
    leaderOnly: false,
  });
  console.log(`Deploy fee: ${describeFee(estimate)}`);
  const hash = await client.deployContract({
    code: new Uint8Array(code),
    args: [],
    leaderOnly: false,
    ...feeArgs,
  });
  pending = { hash };
  await writeFile('.keys/deploy-state.json', JSON.stringify(pending));
  console.log(`Deployment submitted: ${hash}`);
} else console.log(`Tracking existing deployment: ${pending.hash}`);
const receipt = await client.waitForTransactionReceipt({
  hash: pending.hash,
  waitUntil: 'finalized',
  interval: 5000,
  retries: 24,
});
await writeFile(
  'artifacts/studio-deployment-receipt.json',
  JSON.stringify(
    receipt,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
console.log(`Deployment status: ${receipt.statusName ?? receipt.status}`);
const address =
  receipt.data?.contract_address ?? receipt.to_address ?? receipt.recipient;
if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
  throw new Error('No deployed contract address; inspect the saved receipt.');
const version = await client.readContract({
  address,
  functionName: 'get_version',
  args: [],
  transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
});
if (version !== 'agenthon/1.0')
  throw new Error('Deployed contract version check failed.');
const deployment = {
  network: 'studioDevnet',
  contract: address,
  transaction: pending.hash,
};
await writeFile(
  'lib/deployment.json',
  JSON.stringify(deployment, null, 2) + '\n',
);
console.log(`Agenthon deployed and read back: ${address}`);
