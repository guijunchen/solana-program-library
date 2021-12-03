/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import os from 'os';
import fs from 'mz/fs';
import path from 'path';
// import yaml from 'yaml';
import {Keypair, Account} from '@solana/web3.js';
// import {Account} from '@solana/web3.js';
/**
 * @private
//  */
// async function getConfig(): Promise<any> {
//   // Path to Solana CLI config file
//   const CONFIG_FILE_PATH = path.resolve(
//     os.homedir(),
//     '.config',
//     'solana',
//     'cli',
//     'config.yml',
//   );
//   const configYml = await fs.readFile(CONFIG_FILE_PATH, {encoding: 'utf8'});
//   return yaml.parse(configYml);
// }

/**
 * Load and parse the Solana CLI config file to determine which RPC url to use
 */
// export async function getRpcUrl(): Promise<string> {
//   try {
//     const config = await getConfig();
//     if (!config.json_rpc_url) throw new Error('Missing RPC URL');
//     return config.json_rpc_url;
//   } catch (err) {
//     console.warn(
//       'Failed to read RPC url from CLI config file, falling back to localhost',
//     );
//     return 'http://localhost:8899';
//   }
// }

/**
 * Load and parse the Solana CLI config file to determine which payer to use
 */
// export async function getPayer(): Promise<Keypair> {
//   try {
//     const config = await getConfig();
//     if (!config.keypair_path) throw new Error('Missing keypair path');
//     return await createKeypairFromFile(config.keypair_path);
//   } catch (err) {
//     console.warn(
//       'Failed to create keypair from CLI config file, falling back to new random keypair',
//     );
//     return Keypair.generate();
//   }
// }

/**
 * Create a Keypair from a secret key stored in file as bytes' array
 */
export async function createKeypairFromFile(
    dir: string,
    filename: string,  
): Promise<Keypair> {
    const filePath = path.resolve(
        "./",
        'ghost',
        dir,
        filename,
      );
    // console.log('createKeypairFromFile filePath: ',filePath);
  const secretKeyString = await fs.readFile(filePath, {encoding: 'utf8'});
//   console.log("secretKeyString:", secretKeyString)
//   const secretKey = Uint8Array.from(secretKeyString);
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
}

export async function createKeypairToFile(
    dir: string,
    filename: string,
  ): Promise<Keypair> {
    const filePath = path.resolve(
        "./",
        'ghost',
        dir,
        filename,
      );
    // console.log('createKeypairToFile filePath: ',filePath);
    const keyPair = Keypair.generate();
    let buf =  JSON.stringify(keyPair.secretKey.toString().split(','));
    // console.log("bb", buf);
    // let cc = Uint8Array.from(JSON.parse(buf));
    // console.log("cc", cc);
    // console.log("dd", Keypair.fromSecretKey(cc).publicKey.toBase58())
    await fs.writeFile(filePath, buf, { flag: 'a', encoding: 'utf8' });
    return Keypair.fromSecretKey(keyPair.secretKey);
}

async function test() {
    // const keypair = Keypair.generate()
    let keyin = await createKeypairToFile("testlocalnet", "pay3.key");
    console.log("key:", keyin.publicKey.toBase58())
    let keyout = await createKeypairFromFile("testlocalnet", "pay3.key");
    console.log("key:", keyout.publicKey.toBase58())
}


async function test2() {
    // const keypair = Keypair.generate()
    // let a = keypair.secretKey.buffer
    let keyout = await createKeypairFromFile("testlocalnet", "pay2.key");
    console.log("key:", keyout.publicKey.toBase58())
}

async function test3() {
    try {
        let keyout = await createKeypairFromFile("testlocalnet", "pay3.key");
        console.log("key:", keyout.publicKey.toBase58());
    } catch(error) {
        console.log("errror:", error);
    }
}
// test()
// test2()

// test3()
 