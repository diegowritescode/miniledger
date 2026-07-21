export interface Account {
  id: string;
  type: string;
  currency: string;
  balance: string;
  overdraftFloor: string | null;
  createdAt: string;
}

export interface StatementEntry {
  seq: number;
  transactionId: string;
  amount: string;
  balanceAfter: string;
  createdAt: string;
}

export interface Statement {
  entries: StatementEntry[];
  nextCursor: number | null;
}

export interface TransferReceipt {
  transactionId: string;
  postings: {
    accountId: string;
    amount: string;
    balanceAfter: string;
  }[];
}
