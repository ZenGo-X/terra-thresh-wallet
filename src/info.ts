import { get, ChainName } from './api';

export async function getTxInfo(
  txHash: string,
  chainName: ChainName,
): Promise<any> {
  return get(chainName, `/v1/tx/${txHash}`);
}

export async function getSwapRates(
  denom: string,
  chainName: ChainName,
): Promise<any> {
  return get(chainName, `/v1/market/swaprate/${denom}`);
}

export async function getValidators(chainName: ChainName): Promise<any> {
  return get(chainName, `/v1/staking/validators`);
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
    `/v1/txs?` +
    (options.account ? `&account=${options.account}` : '') +
    (options.page ? `&page=${options.page}` : '') +
    (options.limit ? `&limit=${options.limit}` : '');
  return get(chainName, query);
}

export async function getChainID(chainName: ChainName): Promise<string> {
  // This should be replaced with the mainnet endpoint
  let res = await get(chainName, '/node_info');
  let chainID = res.node_info.network;
  return chainID;
}

export async function getValidatorInfo(
  validator: string,
  chainName: ChainName,
): Promise<string> {
  // This should be replaced with the mainnet endpoint
  let res = await get(chainName, `/v1/staking/validators/${validator}`);
  return res;
}

export async function getGasPrices(chainName: ChainName): Promise<GasPrices> {
  // This should be replaced with the mainnet endpoint
  let res: GasPrices = await get(chainName, '/v1/txs/gas_prices');
  return res;
}

export interface GasPrices {
  [key: string]: string;
}
