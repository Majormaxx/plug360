// Plain functions with no SDK imports, so they load anywhere (and in tests) without Circle's browser SDK.

/** Circle error codes and messages that mean the person closed or cancelled the approval window. */
export function isCancelled(err: { code?: number; message?: string } | undefined): boolean {
  if (!err) return false;
  return err.code === 155140 || /cancel|closed|denied|reject/i.test(err.message ?? '');
}

/** Turns whatever Circle's SDK rejected with into a sentence for the person, keeping Circle's code. */
export function loginErrorMessage(err: unknown): string {
  // Circle's SDK rejects with plain strings ("Failed to receive deviceId") or code-only objects; keep the detail.
  console.error('[circle-login]', err);
  if (typeof err === 'string') return `Sign-in failed: ${err}`;
  const e = err as { code?: number; message?: string; status?: number };
  if (isCancelled(e)) return 'Sign-in was cancelled.';
  if (e?.status === 503) return 'Sign-in with Google or email is not set up yet.';
  if (e?.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (/insufficient|gas|balance/i.test(e?.message ?? '')) return 'Your new wallet needs a little USDC for its first transaction. Add some, then activate it from the wallet menu.';
  if (e?.message) return e.code ? `${e.message} (Circle ${e.code})` : e.message;
  return e?.code ? `Sign-in failed (Circle ${e.code}). Try again.` : 'Sign-in failed. Try again.';
}
