const {
  TerraThreshSigClient,
  getTxInfo,
  getTransactions,
  getDelegationInfo,
  getRewardsInfo,
} = require('../dist/src');
const assert = require('assert');

const client = new TerraThreshSigClient();

const network = 'soju';

// This address must be configured with both uluna and uusd
const bank = {
  address: 'terra1xpjtwmemdwz053q4jxjx0ht4dtp25rc799deyf',
};

// This is only for receiving
const account1 = {
  address: 'terra1ya82k8ywtgd7yq8tndf0sejgqd58r66pw5em59',
};

// This address should be empty of any tokens at start of testing
const account2 = {
  address: 'terra1teqqprrnw5mx8mx8pn5hnx3v5jrxkcj2c3356q',
};

describe('Terra API tests', () => {
  it('Transfers uluna to account', async () => {
    await client.init(bank.address);
    const balanceBefore = await client.getBalance(account1.address);
    //console.log('Balance before', balanceBefore._coins.uluna.amount);

    // Init the client
    const res = await client.transfer(account1.address, '10000', 'uluna');
    assert.ok(res.logs[0].success);

    const balanceAfter = await client.getBalance(account1.address);
    const oldBalance = balanceBefore._coins.uluna.amount || 0;
    const newBalance = balanceAfter._coins.uluna.amount;

    const expectedBalance = parseInt(oldBalance) + 10000;
    assert.equal(expectedBalance.toString(), newBalance);
  }).timeout(100000);

  it('Transfers uluna to an account then sends all funds back', async () => {
    await client.init(bank.address);
    const balanceBefore = await client.getBalance(account2.address);
    //console.log(balanceBefore._coins);
    assert.equal(Object.keys(balanceBefore._coins).length, 0);
    // Init the client
    await client.init();
    const res = await client.transfer(account2.address, '10000', 'uluna');

    assert.ok(res.logs[0].success);
    let balanceAfter = await client.getBalance(account2.address);

    balanceAfter = balanceAfter._coins.uluna.amount;
    // console.log('Balance After', balanceAfter);
    assert.equal(balanceAfter, '10000');

    await client.init(account2.address);
    // Send all back to bank
    await client.transfer(bank.address, '10000', 'uluna', null, true);

    const balanceFinally = await client.getBalance(account1.address);
    assert.equal(Object.keys(balanceBefore._coins).length, 0);
  }).timeout(100000);

  it('Transfers uusd to account', async () => {
    await client.init(bank.address);
    const balanceBefore = await client.getBalance(account1.address);
    //console.log('Balance before', balanceBefore._coins.uluna.amount);

    // Init the client
    const res = await client.transfer(account1.address, '10000', 'uusd');
    assert.ok(res.logs[0].success);

    const balanceAfter = await client.getBalance(account1.address);
    const oldBalance = balanceBefore._coins.uusd.amount || 0;
    const newBalance = balanceAfter._coins.uusd.amount;

    const expectedBalance = parseInt(oldBalance) + 10000;
    assert.equal(expectedBalance.toString(), newBalance);
  }).timeout(100000);

  it('Transfers uusd to an account then sends all funds back', async () => {
    await client.init(bank.address);
    const balanceBefore = await client.getBalance(account2.address);
    //console.log(balanceBefore._coins);
    assert.equal(Object.keys(balanceBefore._coins).length, 0);
    // Init the client
    await client.init();
    const res = await client.transfer(account2.address, '10000', 'uusd');

    assert.ok(res.logs[0].success);
    let balanceAfter = await client.getBalance(account2.address);

    balanceAfter = balanceAfter._coins.uusd.amount;
    // console.log('Balance After', balanceAfter);
    assert.equal(balanceAfter, '10000');

    await client.init(account2.address);
    // Send all back to bank
    await client.transfer(bank.address, '10000', 'uusd', null, true);

    const balanceFinally = await client.getBalance(account1.address);
    assert.equal(Object.keys(balanceBefore._coins).length, 0);
  }).timeout(100000);

  //TODO:
  // Other coins
  // Swapping
  // API calls
});
