export interface User { id: string; phone: string; firstName: string; lastName: string; email: string | null; tag: string; status: string; tier: number; kycStatus: string; defaultCurrency: string; referralCode: string }
export interface Wallet { id: string; currency: string; balance: number }
export interface WalletSummary { wallets: Wallet[]; held: { currency: string; amount: number }[]; totalUsd: number; totalInDefault: number; defaultCurrency: string }
export interface Transaction {
  id: string; reference: string; type: string; status: string; direction: 'in' | 'out'; method: string | null; provider: string | null; counterpartyName: string | null; account: string | null; recipientId: string | null;
  sendCurrency: string; sendAmount: number; fee: number; rate: number; receiveCurrency: string; receiveAmount: number; note: string | null; category: string | null; failureReason: string | null; createdAt: string; completedAt: string | null;
}
export interface Recipient { id: string; name: string; method: 'mymoney' | 'mobile_money' | 'bank'; provider: string | null; account: string; currency: string; favorite: boolean; lastUsedAt: string | null }
export interface Quote { id: string; method: string; sendCurrency: string; receiveCurrency: string; sendAmount: number; receiveAmount: number; fee: number; total: number; rate: number; expiresAt: string }
export interface MoneyRequest { id: string; box: 'incoming' | 'outgoing'; otherName: string; currency: string; amount: number; note: string | null; status: string; transactionId: string | null; expiresAt: string; createdAt: string }
export interface Pot { id: string; name: string; currency: string; balance: number; target: number; targetDate: string | null; progress: number }
export interface Schedule { id: string; recipientId: string; recipientName: string; currency: string; amount: number; frequency: string; note: string | null; nextRunAt: string; status: string; lastResult: string | null }
export interface Notification { id: string; kind: string; title: string; body: string; transactionId: string | null; readAt: string | null; createdAt: string }
export interface Meta { currencies: { code: string; name: string }[]; categories: string[]; providers: { mobile_money: string[]; bank: string[]; topup: string[] } }
