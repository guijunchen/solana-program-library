// @flow

import {Account, Keypair, Connection} from '@solana/web3.js';

import {sleep} from './sleep';
import {createKeypairFromFile, createKeypairToFile} from './utils'
 
export async function newAccountWithLamports(
  connection: Connection,
  lamports: number = 1000000,
): Promise<Account> {
  const account = new Account();

  let retries = 30;
  await connection.requestAirdrop(account.publicKey, lamports);
  for (;;) {
    await sleep(500);
    if (lamports == (await connection.getBalance(account.publicKey))) {
      return account;
    }
    if (--retries <= 0) {
      break;
    }
  }
  throw new Error(`Airdrop of ${lamports} failed`);
}


export async function newAccountWithLamportsOrFromFile(
  connection: Connection,
  lamports: number = 1000000,
  dir: string,
  fileName: string,
): Promise<Keypair> {
  try {
    let keyout = await createKeypairFromFile(dir, fileName);
    console.log("newAccountWithLamportsOrFromFile createKeypairFromFile publicKey:", keyout.publicKey.toBase58());
    return keyout;
  } catch(error) {
      // console.log("createKeypairFromFile find file error, try to newKeypairWithLamports to file");
      let keypair = await newKeypairWithLamports(connection, lamports, dir, fileName);
      return keypair;
  }
  // throw new Error(`Airdrop of ${lamports} failed`);
}

export async function newKeypairWithLamports(
  connection: Connection,
  lamports: number = 1000000,
  dir: string,
  fileName: string,
): Promise<Keypair> {
  let keyout = await createKeypairToFile(dir, fileName);
  console.log("newKeypairWithLamports createKeypairToFile publicKey:", keyout.publicKey.toBase58())
  let retries = 30;
  await connection.requestAirdrop(keyout.publicKey, lamports);
  for (;;) {
    await sleep(500);
    if (lamports == (await connection.getBalance(keyout.publicKey))) {
      return keyout;
    }
    if (--retries <= 0) {
      break;
    }
  }
  throw new Error(`Airdrop of ${lamports} failed`);
}

export async function newAccountOrFromFile(
  connection: Connection,
  dir: string,
  fileName: string,
): Promise<Keypair> {
  try {
    let keyout = await createKeypairFromFile(dir, fileName);
    console.log("newAccountOrFromFile createKeypairFromFile publicKey:", keyout.publicKey.toBase58());
    return keyout;
  } catch(error) {
      // console.log("createKeypairFromFile find file error, try to newKeypair to file");
      let keypair = await newKeypair(connection, dir, fileName);
      return keypair;
  }
}

export async function newKeypair(
  connection: Connection,
  dir: string,
  fileName: string,
): Promise<Keypair> {
  let keyout = await createKeypairToFile(dir, fileName);
  console.log("newKeypair createKeypairToFile publicKey:", keyout.publicKey.toBase58());
  return keyout;
}

async function test() {
  let url = 'http://localhost:8899';
  let connection = new Connection(url, 'recent');
  const version = await connection.getVersion();
  let keypair = await newAccountWithLamportsOrFromFile(connection, 1000000000, "testlocalnet", "test5.key");
  console.log("keypair:", keypair.publicKey.toBase58());
}

async function test2() {
  let url = 'http://localhost:8899';
  let connection = new Connection(url, 'recent');
  const version = await connection.getVersion();
  let keypair = await newAccountOrFromFile(connection, "testlocalnet", "test7.key");
  console.log("keypair:", keypair.publicKey.toBase58());
}
// test2();
// test()