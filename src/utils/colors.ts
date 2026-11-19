const ACCOUNT_PALETTE = ['#c96442', '#2563eb', '#16a34a', '#9333ea', '#d97706', '#0891b2'];

export function accountColor(accountId: string): string {
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) {
    hash = (hash * 31 + accountId.charCodeAt(i)) | 0;
  }
  return ACCOUNT_PALETTE[Math.abs(hash) % ACCOUNT_PALETTE.length];
}
