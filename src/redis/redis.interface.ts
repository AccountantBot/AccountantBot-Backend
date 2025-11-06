export interface TransactionData {
  type: 'transaction';
  chatId: number;
  requester: number;
  transaction: any;
  createdAt: string;
}

export interface RedisTransaction {
  key: string;
  data: TransactionData;
  ttl: number;
}
