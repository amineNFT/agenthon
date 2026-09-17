export type BrowserProvider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  providers?: BrowserProvider[];
  isRabby?: boolean;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
};
export type WalletOption = {
  id: string;
  name: string;
  provider: BrowserProvider;
};
export type WalletSession = { provider: BrowserProvider; address: string };
type WalletWindow = EventTarget & { ethereum?: BrowserProvider };

/**
 * The wallet to connect to without asking. A canonical EIP-6963 announcement is
 * preferred over a legacy injected provider; the first detected wallet is the
 * fallback so a single installed extension connects immediately.
 */
export function preferredWallet(
  options: WalletOption[],
): WalletOption | undefined {
  return options.find((option) => option.id.startsWith('eip6963:')) ?? options[0];
}
export type WalletNetwork = {
  id: number;
  name: string;
  rpcUrls: { default: { http: readonly string[] } };
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorers?: { default: { url: string } };
};
declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}

export function discoverWallets(
  target: WalletWindow,
  update: (wallets: WalletOption[]) => void,
) {
  const wallets: WalletOption[] = [];
  const add = (provider: BrowserProvider, id: string, name: string) => {
    if (!provider || typeof provider.request !== 'function') return;
    const announced = id.startsWith('eip6963:');
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = wallets.find((w) => w.provider === provider);
    if (existing) {
      if (announced) {
        existing.id = id;
        existing.name = name;
      }
    } else if (!wallets.some((w) => w.id === id)) {
      // One extension can be reachable both as an EIP-6963 announcement and as
      // a legacy injected provider ("Rabby" and "Rabby Wallet"), which would
      // otherwise list the same wallet twice. Compare normalised names.
      const twin = wallets.find(
        (w) =>
          w.id.startsWith('eip6963:') !== announced &&
          (w.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(key) ||
            key.includes(w.name.toLowerCase().replace(/[^a-z0-9]/g, ''))),
      );
      if (twin) {
        // The announcement is the canonical entry point, so it wins.
        if (announced) {
          twin.id = id;
          twin.name = name;
          twin.provider = provider;
        }
      } else {
        wallets.push({ id, name, provider });
      }
    }
    update([...wallets]);
  };
  const legacy = () => {
    const injected = target.ethereum;
    const providers = injected?.providers?.length
      ? injected.providers
      : injected
        ? [injected]
        : [];
    for (const [index, provider] of providers.entries()) {
      const name = provider.isRabby
        ? 'Rabby'
        : provider.isCoinbaseWallet
          ? 'Coinbase Wallet'
          : provider.isMetaMask
            ? 'MetaMask'
            : 'Browser wallet';
      add(provider, `injected:${index}`, name);
    }
  };
  const announce = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (
      !detail ||
      typeof detail.info?.uuid !== 'string' ||
      typeof detail.info?.name !== 'string'
    )
      return;
    add(
      detail.provider,
      `eip6963:${detail.info.uuid.slice(0, 100)}`,
      detail.info.name.slice(0, 80),
    );
  };
  target.addEventListener('eip6963:announceProvider', announce);
  target.addEventListener('ethereum#initialized', legacy);
  legacy();
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => {
    target.removeEventListener('eip6963:announceProvider', announce);
    target.removeEventListener('ethereum#initialized', legacy);
  };
}

function chainMatches(value: unknown, id: number): boolean {
  try {
    return typeof value === 'string' && BigInt(value) === BigInt(id);
  } catch {
    return false;
  }
}
function unknownChain(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 4) return false;
  const record = error as Record<string, unknown>;
  return (
    Number(record.code) === 4902 ||
    (record.data !== error && unknownChain(record.data, depth + 1)) ||
    (record.originalError !== error &&
      unknownChain(record.originalError, depth + 1))
  );
}
function accountAddress(accounts: unknown): string {
  const address = Array.isArray(accounts) ? accounts[0] : null;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address))
    throw new Error(
      'No wallet account is connected. Unlock your wallet and connect again.',
    );
  return address;
}
export async function prepareWallet(
  provider: BrowserProvider,
  chain: WalletNetwork,
  expectedAddress?: string,
): Promise<string> {
  const address = accountAddress(
    await provider.request({
      method: expectedAddress ? 'eth_accounts' : 'eth_requestAccounts',
    }),
  );
  if (
    expectedAddress &&
    address.toLowerCase() !== expectedAddress.toLowerCase()
  )
    throw new Error(
      'The wallet account changed. Connect the account you want to use before continuing.',
    );
  if (
    !chainMatches(await provider.request({ method: 'eth_chainId' }), chain.id)
  ) {
    const chainId = `0x${chain.id.toString(16)}`;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      });
    } catch (error) {
      if (!unknownChain(error)) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [...chain.rpcUrls.default.http],
            ...(chain.blockExplorers?.default.url
              ? { blockExplorerUrls: [chain.blockExplorers.default.url] }
              : {}),
          },
        ],
      });
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      });
    }
  }
  await assertWalletState(provider, chain, address);
  return address;
}
export async function assertWalletState(
  provider: BrowserProvider,
  chain: WalletNetwork,
  address: string,
) {
  if (
    !chainMatches(await provider.request({ method: 'eth_chainId' }), chain.id)
  )
    throw new Error(
      `Switch your selected wallet to ${chain.name} (chain ${chain.id}), then try again.`,
    );
  const current = accountAddress(
    await provider.request({ method: 'eth_accounts' }),
  );
  if (current.toLowerCase() !== address.toLowerCase())
    throw new Error(
      'The wallet account changed. Reconnect before sending a transaction.',
    );
}
/** Keep the SDK bound to the selected extension, even when window.ethereum changes. */
export function signingProvider(
  session: WalletSession,
  chain: WalletNetwork,
): BrowserProvider {
  return {
    request: async (request) => {
      if (
        request.method === 'eth_sendTransaction' ||
        request.method === 'eth_signTransaction'
      ) {
        await assertWalletState(session.provider, chain, session.address);
        const transaction = Array.isArray(request.params)
          ? (request.params[0] as { from?: string })
          : null;
        if (transaction?.from?.toLowerCase() !== session.address.toLowerCase())
          throw new Error(
            'The transaction sender does not match the selected wallet account.',
          );
      }
      return session.provider.request(request);
    },
  };
}
