const rp = require('request-promise');
export const Chains = {
  columbus: 'https://fcd.terra.dev',
  tequila: 'https://tequila-fcd.terra.dev',
  soju: 'https://soju-fcd.terra.dev',
};

export type ChainName = 'columbus' | 'soju' | 'tequila';

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
