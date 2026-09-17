/** Wallet extensions often reject with plain objects, not Error instances. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim())
      return record.message;
    if (typeof record.shortMessage === 'string' && record.shortMessage.trim())
      return record.shortMessage;
  }
  return 'The action could not be completed. Please try again.';
}

export function walletError(error: unknown, stage: string): string {
  const code =
    error && typeof error === 'object'
      ? Number((error as Record<string, unknown>).code)
      : NaN;
  if (code === 4001)
    return 'The wallet request was declined. Try again when you are ready to approve it in your selected wallet.';
  if (code === -32002)
    return 'A wallet request is already waiting. Open your selected wallet and finish or cancel that request, then try again.';
  if (code === 4200 || code === -32601)
    return `Your wallet does not support a request needed for ${stage}. If network switching is unsupported, add and select the GenLayer network in your wallet manually. Wallet details: ${errorMessage(error)}`;
  return `Could not finish ${stage}. ${errorMessage(error)}`;
}
