import {sendAndConfirmTransaction as realSendAndConfirmTransaction} from '@solana/web3.js';
import type {
  Account,
  Keypair,
  Connection,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';

export function sendAndConfirmTransaction(
  title: string,
  connection: Connection,
  transaction: Transaction,
  ...signers: Array<Keypair>
): Promise<TransactionSignature> {
  return realSendAndConfirmTransaction(connection, transaction, signers, {
    skipPreflight: false,
    commitment: 'recent',
    preflightCommitment: 'recent',
  });
}
