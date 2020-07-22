const rp = require('request-promise');
const Chains = {
  columbus_2: 'https://api.cosmos.network',
  soju: 'https://soju-fcd.terra.dev/v1',
  // txs?account=terra1xpjtwmemdwz053q4jxjx0ht4dtp25rc799deyf&page=1&chainId=soju-0014&order=ASC&action=send
  //soju: 'http://52.78.69.160:1317',
};

export type ChainName = 'columbus_2' | 'soju';

export async function get(chainName: ChainName, route: string): Promise<any> {
  console.log(`${Chains[chainName]}${route}`);
  return rp({
    method: 'GET',
    uri: `${Chains[chainName]}${route}`,
    json: true,
  });
}

export async function post(
  chainName: ChainName,
  route: string,
  body: any,
): Promise<any> {
  // console.log(`${Chains[chainName]}${route}`);
  // console.log(JSON.stringify(body));
  return rp({
    method: 'POST',
    uri: `${Chains[chainName]}${route}`,
    body,
    json: true,
  });
}
