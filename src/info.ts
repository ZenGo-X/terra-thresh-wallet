import { get, ChainName } from './api';

export async function getTxInfo(
  txHash: string,
  chainName: ChainName,
): Promise<any> {
  return get(chainName, `/tx/${txHash}`);
}

interface GetTransactionsOptions {
  account?: string;
  receiver?: string;
  page?: string;
  limit?: string;
  network?: ChainName;
}

export async function getTransactions(options: GetTransactionsOptions = {}) {
  const chainName = (options && options.network) || 'soju';
  const query =
    `/txs?` +
    (options.account ? `&account=${options.account}` : '') +
    (options.page ? `&page=${options.page}` : '') +
    (options.limit ? `&limit=${options.limit}` : '');
  return get(chainName, query);
}
