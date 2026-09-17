import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareWallet,
  preferredWallet,
  signingProvider,
  discoverWallets,
  type BrowserProvider,
} from '../../lib/wallet.ts';

const address = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const chain = {
  id: 61997,
  name: 'GenLayer Studio Next',
  rpcUrls: { default: { http: ['https://studio-dev.genlayer.com/api'] } },
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
};
function fixture(initialChain = '0xf22d', unknown = false) {
  const calls: string[] = [];
  const state = {
    chain: initialChain,
    account: address,
    unknown,
    switched: true,
  };
  const provider: BrowserProvider = {
    isRabby: true,
    request: async ({ method, params }) => {
      calls.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts')
        return [state.account];
      if (method === 'eth_chainId') return state.chain;
      if (method === 'wallet_switchEthereumChain') {
        if (state.unknown) throw { code: 4902, message: 'Unknown chain' };
        if (state.switched)
          state.chain = (params as { chainId: string }[])[0].chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        state.unknown = false;
        return null;
      }
      if (method === 'eth_sendTransaction') return '0xtransaction';
      throw new Error(`Unexpected wallet method: ${method}`);
    },
  };
  return { provider, calls, state };
}
void test('Rabby-style provider connects and signs using standard requests only', async () => {
  const { provider, calls } = fixture();
  assert.equal(await prepareWallet(provider, chain), address);
  const selected = signingProvider({ provider, address }, chain);
  assert.equal(
    await selected.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }],
    }),
    '0xtransaction',
  );
  assert.ok(calls.includes('eth_sendTransaction'));
  assert.ok(!calls.some((method) => /snap/i.test(method)));
});
void test('unknown custom network is added, switched, and verified', async () => {
  const { provider, calls } = fixture('0x1', true);
  assert.equal(await prepareWallet(provider, chain), address);
  assert.equal(
    calls.filter((method) => method === 'wallet_switchEthereumChain').length,
    2,
  );
  assert.equal(
    calls.filter((method) => method === 'wallet_addEthereumChain').length,
    1,
  );
});
void test('declined network switch is not converted into an add-network prompt', async () => {
  const { provider, calls } = fixture('0x1');
  const original = provider.request;
  provider.request = async (request) => {
    if (request.method === 'wallet_switchEthereumChain')
      throw { code: 4001, message: 'declined' };
    return original(request);
  };
  await assert.rejects(prepareWallet(provider, chain));
  assert.ok(!calls.includes('wallet_addEthereumChain'));
});
void test('a wallet that stays on the wrong chain cannot connect or sign', async () => {
  const { provider, calls, state } = fixture('0x1');
  state.switched = false;
  await assert.rejects(
    prepareWallet(provider, chain),
    /Switch your selected wallet/,
  );
  await assert.rejects(
    signingProvider({ provider, address }, chain).request({
      method: 'eth_sendTransaction',
      params: [{ from: address }],
    }),
    /Switch your selected wallet/,
  );
  assert.ok(!calls.includes('eth_sendTransaction'));
});
void test('account changes and wrong senders stop signing', async () => {
  const { provider, calls, state } = fixture();
  state.account = other;
  await assert.rejects(
    prepareWallet(provider, chain, address),
    /account changed/,
  );
  const selected = signingProvider({ provider, address }, chain);
  await assert.rejects(
    selected.request({
      method: 'eth_sendTransaction',
      params: [{ from: address }],
    }),
    /account changed/,
  );
  state.account = address;
  await assert.rejects(
    selected.request({
      method: 'eth_sendTransaction',
      params: [{ from: other }],
    }),
    /sender does not match/,
  );
  assert.ok(!calls.includes('eth_sendTransaction'));
});
void test('discovery retains multiple providers, deduplicates announcements, and cleans up', () => {
  const a = fixture().provider,
    b = fixture().provider;
  const target = Object.assign(new EventTarget(), { ethereum: a });
  let current: { name: string; provider: BrowserProvider }[] = [];
  const stop = discoverWallets(target, (wallets) => {
    current = wallets;
  });
  const announce = (provider: BrowserProvider, uuid: string, name: string) =>
    target.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: { info: { uuid, name }, provider },
      }),
    );
  announce(a, 'a', 'Rabby Wallet');
  announce(b, 'b', 'Second wallet');
  announce(a, 'a', 'Rabby Wallet');
  assert.equal(current.length, 2);
  assert.equal(current[0].name, 'Rabby Wallet');
  assert.equal(current[1].provider, b);
  stop();
  announce(fixture().provider, 'c', 'Late wallet');
  assert.equal(current.length, 2);
});
void test('the canonical announcement is chosen without a picker', () => {
  const a = fixture().provider,
    b = fixture().provider;
  assert.equal(preferredWallet([]), undefined);
  assert.equal(
    preferredWallet([{ id: 'injected:0', name: 'Rabby', provider: a }])
      ?.provider,
    a,
  );
  // When the same wallet is also announced, the announcement wins.
  assert.equal(
    preferredWallet([
      { id: 'injected:0', name: 'Rabby', provider: a },
      { id: 'eip6963:1', name: 'Rabby Wallet', provider: b },
    ])?.provider,
    b,
  );
});
void test('one extension is not listed as two wallets', () => {
  const injected = fixture().provider;
  const announced = fixture().provider;
  const target = Object.assign(new EventTarget(), { ethereum: injected });
  let current: { id: string; name: string; provider: BrowserProvider }[] = [];
  const stop = discoverWallets(target, (wallets) => {
    current = wallets;
  });
  // The legacy injected provider is named "Rabby" from its isRabby flag.
  assert.equal(current.length, 1);
  assert.equal(current[0].name, 'Rabby');
  target.dispatchEvent(
    new CustomEvent('eip6963:announceProvider', {
      detail: {
        info: { uuid: 'rabby', name: 'Rabby Wallet' },
        provider: announced,
      },
    }),
  );
  // "Rabby" and "Rabby Wallet" are the same extension: one entry, announcement wins.
  assert.equal(current.length, 1);
  assert.equal(current[0].name, 'Rabby Wallet');
  assert.equal(current[0].provider, announced);
  stop();
});
