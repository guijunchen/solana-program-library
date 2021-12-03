import assert from 'assert';
import BN from 'bn.js';
import {Buffer} from 'buffer';
import * as BufferLayout from 'buffer-layout';
import type {Connection, TransactionSignature} from '@solana/web3.js';
import {
  Account,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

import * as Layout from './layout';
import {sendAndConfirmTransaction} from './util/send-and-confirm-transaction';
import {loadAccount} from './util/account';

// export const TOKEN_SWAP_PROGRAM_ID: PublicKey = new PublicKey(
//   'SwaPpA9LAaLfeLi3a68M4DjnLqgtticKg6CnyNwgAC8',
// );

export const TOKEN_SWAP_PROGRAM_ID: PublicKey = new PublicKey(
  '53hXUL3XeUYynAsWhGZRmos3kLFusWPdtgwxoA597NYE',
);

/**
 * Some amount of tokens
 */
export class Numberu64 extends BN {
  /**
   * Convert to Buffer representation
   */
  toBuffer(): Buffer {
    const a = super.toArray().reverse();
    const b = Buffer.from(a);
    if (b.length === 8) {
      return b;
    }
    assert(b.length < 8, 'Numberu64 too large');

    const zeroPad = Buffer.alloc(8);
    b.copy(zeroPad);
    return zeroPad;
  }

  /**
   * Construct a Numberu64 from Buffer representation
   */
  static fromBuffer(buffer: Buffer): Numberu64 {
    assert(buffer.length === 8, `Invalid buffer length: ${buffer.length}`);
    return new Numberu64(
      [...buffer]
        .reverse()
        .map(i => `00${i.toString(16)}`.slice(-2))
        .join(''),
      16,
    );
  }
}

export const TokenSwapLayout = BufferLayout.struct([
  BufferLayout.u8('version'),
  BufferLayout.u8('isInitialized'),
  BufferLayout.u8('bumpSeed'),
  Layout.publicKey('tokenProgramId'),
  Layout.publicKey('tokenAccountA'),
  Layout.publicKey('tokenAccountB'),
  Layout.publicKey('tokenPool'),
  Layout.publicKey('mintA'),
  Layout.publicKey('mintB'),
  Layout.publicKey('feeAccount'),
  Layout.uint64('tradeFeeNumerator'),
  Layout.uint64('tradeFeeDenominator'),
  Layout.uint64('ownerTradeFeeNumerator'),
  Layout.uint64('ownerTradeFeeDenominator'),
  Layout.uint64('ownerWithdrawFeeNumerator'),
  Layout.uint64('ownerWithdrawFeeDenominator'),
  Layout.uint64('hostFeeNumerator'),
  Layout.uint64('hostFeeDenominator'),
  BufferLayout.u8('curveType'),
  BufferLayout.blob(32, 'curveParameters'),
]);

export const CurveType = Object.freeze({
  ConstantProduct: 0, // Constant product curve, Uniswap-style
  ConstantPrice: 1, // Constant price curve, always X amount of A token for 1 B token, where X is defined at init
  Offset: 3, // Offset curve, like Uniswap, but with an additional offset on the token B side
});

/**
 * A program to exchange tokens against a pool of liquidity
 */
export class TokenSwap {
  /**
   * Create a Token object attached to the specific token
   *
   * @param connection The connection to use
   * @param tokenSwap The token swap account
   * @param swapProgramId The program ID of the token-swap program
   * @param tokenProgramId The program ID of the token program
   * @param poolToken The pool token
   * @param authority The authority over the swap and accounts
   * @param tokenAccountA The token swap's Token A account
   * @param tokenAccountB The token swap's Token B account
   * @param mintA The mint of Token A
   * @param mintB The mint of Token B
   * @param tradeFeeNumerator The trade fee numerator
   * @param tradeFeeDenominator The trade fee denominator
   * @param ownerTradeFeeNumerator The owner trade fee numerator
   * @param ownerTradeFeeDenominator The owner trade fee denominator
   * @param ownerWithdrawFeeNumerator The owner withdraw fee numerator
   * @param ownerWithdrawFeeDenominator The owner withdraw fee denominator
   * @param hostFeeNumerator The host fee numerator
   * @param hostFeeDenominator The host fee denominator
   * @param curveType The curve type
   * @param payer Pays for the transaction
   */
  constructor(
    private connection: Connection,
    public tokenSwap: PublicKey,
    public swapProgramId: PublicKey,
    public tokenProgramId: PublicKey,
    public poolToken: PublicKey,
    public feeAccount: PublicKey,
    public authority: PublicKey,
    public tokenAccountA: PublicKey,
    public tokenAccountB: PublicKey,
    public mintA: PublicKey,
    public mintB: PublicKey,
    public tradeFeeNumerator: Numberu64,
    public tradeFeeDenominator: Numberu64,
    public ownerTradeFeeNumerator: Numberu64,
    public ownerTradeFeeDenominator: Numberu64,
    public ownerWithdrawFeeNumerator: Numberu64,
    public ownerWithdrawFeeDenominator: Numberu64,
    public hostFeeNumerator: Numberu64,
    public hostFeeDenominator: Numberu64,
    public curveType: number,
    public payer: Keypair,
  ) {
    this.connection = connection;
    this.tokenSwap = tokenSwap; //tokenSwapAccount 钱包账户 这个才是真正createTokenSwap的地址 tokenSwapAccount.key
    this.swapProgramId = swapProgramId; //swap 合约地址
    this.tokenProgramId = tokenProgramId; // token 合约地址
    this.poolToken = poolToken; //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
    this.feeAccount = feeAccount; //feeAccount 创建own对tokenPool mint的关联账户:tokenPool.createAccount(new PublicKey(ownerKey))
    this.authority = authority; //authority 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址
    this.tokenAccountA = tokenAccountA; //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
    this.tokenAccountB = tokenAccountB; //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
    this.mintA = mintA; //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
    this.mintB = mintB; //mintB 创建token B mint Token.createMint(payer,owner.publicKey)
    this.tradeFeeNumerator = tradeFeeNumerator;
    this.tradeFeeDenominator = tradeFeeDenominator;
    this.ownerTradeFeeNumerator = ownerTradeFeeNumerator;
    this.ownerTradeFeeDenominator = ownerTradeFeeDenominator;
    this.ownerWithdrawFeeNumerator = ownerWithdrawFeeNumerator;
    this.ownerWithdrawFeeDenominator = ownerWithdrawFeeDenominator;
    this.hostFeeNumerator = hostFeeNumerator;
    this.hostFeeDenominator = hostFeeDenominator;
    this.curveType = curveType;
    this.payer = payer;//swapPayer 钱包账号并且有空投币1000000000
  }

  /**
   * Get the minimum balance for the token swap account to be rent exempt
   *
   * @return Number of lamports required
   */
  static async getMinBalanceRentForExemptTokenSwap(
    connection: Connection,
  ): Promise<number> {
    return await connection.getMinimumBalanceForRentExemption(
      TokenSwapLayout.span,
    );
  }

  static createInitSwapInstruction(
    tokenSwapAccount: Keypair,
    authority: PublicKey,
    tokenAccountA: PublicKey,
    tokenAccountB: PublicKey,
    tokenPool: PublicKey,
    feeAccount: PublicKey,
    tokenAccountPool: PublicKey,
    tokenProgramId: PublicKey,
    swapProgramId: PublicKey,
    tradeFeeNumerator: number,
    tradeFeeDenominator: number,
    ownerTradeFeeNumerator: number,
    ownerTradeFeeDenominator: number,
    ownerWithdrawFeeNumerator: number,
    ownerWithdrawFeeDenominator: number,
    hostFeeNumerator: number,
    hostFeeDenominator: number,
    curveType: number,
    curveParameters: Numberu64 = new Numberu64(0),
  ): TransactionInstruction {
    const keys = [
      {pubkey: tokenSwapAccount.publicKey, isSigner: false, isWritable: true},
      {pubkey: authority, isSigner: false, isWritable: false},
      {pubkey: tokenAccountA, isSigner: false, isWritable: false},
      {pubkey: tokenAccountB, isSigner: false, isWritable: false},
      {pubkey: tokenPool, isSigner: false, isWritable: true},
      {pubkey: feeAccount, isSigner: false, isWritable: false},
      {pubkey: tokenAccountPool, isSigner: false, isWritable: true},
      {pubkey: tokenProgramId, isSigner: false, isWritable: false},
    ];
    const commandDataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      BufferLayout.nu64('tradeFeeNumerator'),
      BufferLayout.nu64('tradeFeeDenominator'),
      BufferLayout.nu64('ownerTradeFeeNumerator'),
      BufferLayout.nu64('ownerTradeFeeDenominator'),
      BufferLayout.nu64('ownerWithdrawFeeNumerator'),
      BufferLayout.nu64('ownerWithdrawFeeDenominator'),
      BufferLayout.nu64('hostFeeNumerator'),
      BufferLayout.nu64('hostFeeDenominator'),
      BufferLayout.u8('curveType'),
      BufferLayout.blob(32, 'curveParameters'),
    ]);
    let data = Buffer.alloc(1024);

    // package curve parameters
    // NOTE: currently assume all curves take a single parameter, u64 int
    //       the remaining 24 of the 32 bytes available are filled with 0s
    let curveParamsBuffer = Buffer.alloc(32);
    curveParameters.toBuffer().copy(curveParamsBuffer);

    {
      const encodeLength = commandDataLayout.encode(
        {
          instruction: 0, // InitializeSwap instruction
          tradeFeeNumerator,
          tradeFeeDenominator,
          ownerTradeFeeNumerator,
          ownerTradeFeeDenominator,
          ownerWithdrawFeeNumerator,
          ownerWithdrawFeeDenominator,
          hostFeeNumerator,
          hostFeeDenominator,
          curveType,
          curveParameters: curveParamsBuffer,
        },
        data,
      );
      data = data.slice(0, encodeLength);
    }
    return new TransactionInstruction({
      keys,
      programId: swapProgramId,
      data,
    });
  }

  static async loadTokenSwap(
    connection: Connection,
    address: PublicKey,
    programId: PublicKey,
    payer: Keypair,
  ): Promise<TokenSwap> {
    const data = await loadAccount(connection, address, programId);
    const tokenSwapData = TokenSwapLayout.decode(data);
    if (!tokenSwapData.isInitialized) {
      throw new Error(`Invalid token swap state`);
    }

    const [authority] = await PublicKey.findProgramAddress(
      [address.toBuffer()],
      programId,
    );

    const poolToken = new PublicKey(tokenSwapData.tokenPool);
    const feeAccount = new PublicKey(tokenSwapData.feeAccount);
    const tokenAccountA = new PublicKey(tokenSwapData.tokenAccountA);
    const tokenAccountB = new PublicKey(tokenSwapData.tokenAccountB);
    const mintA = new PublicKey(tokenSwapData.mintA);
    const mintB = new PublicKey(tokenSwapData.mintB);
    const tokenProgramId = new PublicKey(tokenSwapData.tokenProgramId);

    const tradeFeeNumerator = Numberu64.fromBuffer(
      tokenSwapData.tradeFeeNumerator,
    );
    const tradeFeeDenominator = Numberu64.fromBuffer(
      tokenSwapData.tradeFeeDenominator,
    );
    const ownerTradeFeeNumerator = Numberu64.fromBuffer(
      tokenSwapData.ownerTradeFeeNumerator,
    );
    const ownerTradeFeeDenominator = Numberu64.fromBuffer(
      tokenSwapData.ownerTradeFeeDenominator,
    );
    const ownerWithdrawFeeNumerator = Numberu64.fromBuffer(
      tokenSwapData.ownerWithdrawFeeNumerator,
    );
    const ownerWithdrawFeeDenominator = Numberu64.fromBuffer(
      tokenSwapData.ownerWithdrawFeeDenominator,
    );
    const hostFeeNumerator = Numberu64.fromBuffer(
      tokenSwapData.hostFeeNumerator,
    );
    const hostFeeDenominator = Numberu64.fromBuffer(
      tokenSwapData.hostFeeDenominator,
    );
    const curveType = tokenSwapData.curveType;

    return new TokenSwap(
      connection,
      address,
      programId,
      tokenProgramId,
      poolToken,
      feeAccount,
      authority,
      tokenAccountA,
      tokenAccountB,
      mintA,
      mintB,
      tradeFeeNumerator,
      tradeFeeDenominator,
      ownerTradeFeeNumerator,
      ownerTradeFeeDenominator,
      ownerWithdrawFeeNumerator,
      ownerWithdrawFeeDenominator,
      hostFeeNumerator,
      hostFeeDenominator,
      curveType,
      payer,
    );
  }

  /**
   * Create a new Token Swap
   *
   * @param connection The connection to use
   * @param payer Pays for the transaction
   * @param tokenSwapAccount The token swap account
   * @param authority The authority over the swap and accounts
   * @param tokenAccountA: The token swap's Token A account
   * @param tokenAccountB: The token swap's Token B account
   * @param poolToken The pool token
   * @param tokenAccountPool The token swap's pool token account
   * @param tokenProgramId The program ID of the token program
   * @param swapProgramId The program ID of the token-swap program
   * @param feeNumerator Numerator of the fee ratio
   * @param feeDenominator Denominator of the fee ratio
   * @return Token object for the newly minted token, Public key of the account holding the total supply of new tokens
   */
  static async createTokenSwap(
    connection: Connection,
    payer: Keypair, //swapPayer 钱包账号并且有空投币1000000000
    tokenSwapAccount: Keypair,  //tokenSwapAccount 钱包账户 这个才是真正createTokenSwap的地址 tokenSwapAccount.key
    authority: PublicKey, //authority 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址
    tokenAccountA: PublicKey, //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
    tokenAccountB: PublicKey, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
    poolToken: PublicKey, //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
    mintA: PublicKey, //mintA 创建token A mint Token.createMint(payer,owner.publicKey)
    mintB: PublicKey, //mintB 创建token B mint Token.createMint(payer,owner.publicKey)
    feeAccount: PublicKey, //feeAccount 创建own对tokenPool mint的关联账户:tokenPool.createAccount(new PublicKey(ownerKey))
    tokenAccountPool: PublicKey, //tokenAccountPool 创建own对tokenPool mint的关联账户:tokenPool.createAccount(owner.publicKey);
    swapProgramId: PublicKey, //swap 合约地址
    tokenProgramId: PublicKey, // token 合约地址
    tradeFeeNumerator: number, //TRADING_FEE_NUMERATOR = 25;
    tradeFeeDenominator: number, //TRADING_FEE_DENOMINATOR = 10000;
    ownerTradeFeeNumerator: number, //OWNER_TRADING_FEE_NUMERATOR = 5;
    ownerTradeFeeDenominator: number, //OWNER_TRADING_FEE_DENOMINATOR = 10000;
    ownerWithdrawFeeNumerator: number, //OWNER_WITHDRAW_FEE_NUMERATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 1;1
    ownerWithdrawFeeDenominator: number,//OWNER_WITHDRAW_FEE_DENOMINATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 6;6
    hostFeeNumerator: number,//HOST_FEE_NUMERATOR = 20;
    hostFeeDenominator: number, //HOST_FEE_DENOMINATOR = 100;
    curveType: number, //CurveType.ConstantPrice
    curveParameters?: Numberu64, //new Numberu64(1)
  ): Promise<TokenSwap> {
    let transaction;
    const tokenSwap = new TokenSwap(
      connection,
      tokenSwapAccount.publicKey, //tokenSwapAccount 钱包账户 这个才是真正createTokenSwap的地址 tokenSwapAccount.key
      swapProgramId, //swap 合约地址
      tokenProgramId, // token 合约地址
      poolToken, //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
      feeAccount, //feeAccount 创建own对tokenPool mint的关联账户:tokenPool.createAccount(new PublicKey(ownerKey))
      authority, //authority 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址
      tokenAccountA, //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
      tokenAccountB, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
      mintA, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
      mintB, //mintB 创建token B mint Token.createMint(payer,owner.publicKey)
      new Numberu64(tradeFeeNumerator),
      new Numberu64(tradeFeeDenominator),
      new Numberu64(ownerTradeFeeNumerator),
      new Numberu64(ownerTradeFeeDenominator),
      new Numberu64(ownerWithdrawFeeNumerator),
      new Numberu64(ownerWithdrawFeeDenominator),
      new Numberu64(hostFeeNumerator),
      new Numberu64(hostFeeDenominator),
      curveType,
      payer,
    );

    // Allocate memory for the account
    const balanceNeeded = await TokenSwap.getMinBalanceRentForExemptTokenSwap(
      connection,
    );
    transaction = new Transaction();
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: tokenSwapAccount.publicKey,
        lamports: balanceNeeded,
        space: TokenSwapLayout.span,
        programId: swapProgramId,
      }),
    );

    const instruction = TokenSwap.createInitSwapInstruction(
      tokenSwapAccount,
      authority,
      tokenAccountA,
      tokenAccountB,
      poolToken,
      feeAccount,
      tokenAccountPool,
      tokenProgramId,
      swapProgramId,
      tradeFeeNumerator,
      tradeFeeDenominator,
      ownerTradeFeeNumerator,
      ownerTradeFeeDenominator,
      ownerWithdrawFeeNumerator,
      ownerWithdrawFeeDenominator,
      hostFeeNumerator,
      hostFeeDenominator,
      curveType,
      curveParameters,
    );

    transaction.add(instruction);
    await sendAndConfirmTransaction(
      'createAccount and InitializeSwap',
      connection,
      transaction,
      payer,
      tokenSwapAccount,
    );

    return tokenSwap;
  }

  /**
   * Swap token A for token B
   *
   * @param userSource User's source token account
   * @param poolSource Pool's source token account
   * @param poolDestination Pool's destination token account
   * @param userDestination User's destination token account
   * @param hostFeeAccount Host account to gather fees
   * @param userTransferAuthority Account delegated to transfer user's tokens
   * @param amountIn Amount to transfer from source account
   * @param minimumAmountOut Minimum amount of tokens the user will receive
   */
  async swap(
    userSource: PublicKey, //userAccountA 创建owner对mintA swap账户并征发一定数量的币mintA.createAccount(owner.publicKey)|mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);
    poolSource: PublicKey, //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
    poolDestination: PublicKey, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
    userDestination: PublicKey, //userAccountB 创建owner对mintB swap账户 mintB.createAccount(owner.publicKey);
    hostFeeAccount: PublicKey | null, //创建owner对tokenPool mint swap账户 SWAP_PROGRAM_OWNER_FEE_ADDRESS ? await tokenPool.createAccount(owner.publicKey): null;
    userTransferAuthority: Keypair, // userTransferAuthority Keypair.generate();mintA.approve(userAccountA,userTransferAuthority.publicKey,owner,[],SWAP_AMOUNT_IN,);
    amountIn: number | Numberu64, //SWAP_AMOUNT_IN = 100000;
    minimumAmountOut: number | Numberu64, //SWAP_AMOUNT_OUT = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 90661 : 90674;
  ): Promise<TransactionSignature> {
    return await sendAndConfirmTransaction(
      'swap',
      this.connection,
      new Transaction().add(
        TokenSwap.swapInstruction(
          this.tokenSwap, //tokenSwapAccount 钱包账户 这个才是真正createTokenSwap的地址 tokenSwapAccount.key
          this.authority, //authority 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址
          userTransferAuthority.publicKey, //Swap userTransferAuthority Keypair.generate();mintA.approve(userAccountA,userTransferAuthority.publicKey,owner,[],SWAP_AMOUNT_IN,);
          userSource,//userAccountA 创建owner对mintA swap账户并征发一定数量的币mintA.createAccount(owner.publicKey)|mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);
          poolSource,//tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
          poolDestination,//tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
          userDestination,//userAccountB 创建owner对mintB swap账户 mintB.createAccount(owner.publicKey);
          this.poolToken,//tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
          this.feeAccount,//feeAccount 创建own对tokenPool mint的关联账户:tokenPool.createAccount(new PublicKey(ownerKey))
          hostFeeAccount, //创建owner对tokenPool mint swap账户 SWAP_PROGRAM_OWNER_FEE_ADDRESS ? await tokenPool.createAccount(owner.publicKey): null;
          this.swapProgramId, //swap 合约地址
          this.tokenProgramId, //token 合约地址
          amountIn, //SWAP_AMOUNT_IN = 100000;
          minimumAmountOut, //SWAP_AMOUNT_OUT = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 90661 : 90674;
        ),
      ),
      this.payer, //swapPayer 钱包账号并且有空投币1000000000
      userTransferAuthority, // userTransferAuthority Keypair.generate();mintA.approve(userAccountA,userTransferAuthority.publicKey,owner,[],SWAP_AMOUNT_IN,);
    );
  }

  static swapInstruction(
    tokenSwap: PublicKey,
    authority: PublicKey,
    userTransferAuthority: PublicKey,
    userSource: PublicKey,
    poolSource: PublicKey,
    poolDestination: PublicKey,
    userDestination: PublicKey,
    poolMint: PublicKey,
    feeAccount: PublicKey,
    hostFeeAccount: PublicKey | null,
    swapProgramId: PublicKey,
    tokenProgramId: PublicKey,
    amountIn: number | Numberu64,
    minimumAmountOut: number | Numberu64,
  ): TransactionInstruction {
    const dataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      Layout.uint64('amountIn'),
      Layout.uint64('minimumAmountOut'),
    ]);

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        instruction: 1, // Swap instruction
        amountIn: new Numberu64(amountIn).toBuffer(),
        minimumAmountOut: new Numberu64(minimumAmountOut).toBuffer(),
      },
      data,
    );

    const keys = [
      {pubkey: tokenSwap, isSigner: false, isWritable: false}, //tokenSwapAccount 钱包账户 这个才是真正createTokenSwap的地址 tokenSwapAccount.key
      {pubkey: authority, isSigner: false, isWritable: false}, //authority 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址
      {pubkey: userTransferAuthority, isSigner: true, isWritable: false}, //Swap userTransferAuthority Keypair.generate();mintA.approve(userAccountA,userTransferAuthority.publicKey,owner,[],SWAP_AMOUNT_IN,);
      {pubkey: userSource, isSigner: false, isWritable: true}, //userAccountA 创建owner对mintA swap账户并征发一定数量的币mintA.createAccount(owner.publicKey)|mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);
      {pubkey: poolSource, isSigner: false, isWritable: true}, //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
      {pubkey: poolDestination, isSigner: false, isWritable: true}, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
      {pubkey: userDestination, isSigner: false, isWritable: true}, //userAccountB 创建owner对mintB swap账户 mintB.createAccount(owner.publicKey);
      {pubkey: poolMint, isSigner: false, isWritable: true}, //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
      {pubkey: feeAccount, isSigner: false, isWritable: true}, //feeAccount 创建own对tokenPool mint的关联账户:tokenPool.createAccount(new PublicKey(ownerKey))
      {pubkey: tokenProgramId, isSigner: false, isWritable: false}, //token 合约地址
    ];
    if (hostFeeAccount !== null) {
      keys.push({pubkey: hostFeeAccount, isSigner: false, isWritable: true});//创建owner对tokenPool mint swap账户 SWAP_PROGRAM_OWNER_FEE_ADDRESS ? await tokenPool.createAccount(owner.publicKey): null;
    }
    return new TransactionInstruction({
      keys,
      programId: swapProgramId, //swap 合约地址
      data,
    });
  }

  /**
   * Deposit tokens into the pool
   * @param userAccountA User account for token A
   * @param userAccountB User account for token B
   * @param poolAccount User account for pool token
   * @param userTransferAuthority Account delegated to transfer user's tokens
   * @param poolTokenAmount Amount of pool tokens to mint
   * @param maximumTokenA The maximum amount of token A to deposit
   * @param maximumTokenB The maximum amount of token B to deposit
   */
  async depositAllTokenTypes(
    userAccountA: PublicKey,
    userAccountB: PublicKey,
    poolAccount: PublicKey,
    userTransferAuthority: Keypair,
    poolTokenAmount: number | Numberu64,
    maximumTokenA: number | Numberu64,
    maximumTokenB: number | Numberu64,
  ): Promise<TransactionSignature> {
    return await sendAndConfirmTransaction(
      'depositAllTokenTypes',
      this.connection,
      new Transaction().add(
        TokenSwap.depositAllTokenTypesInstruction(
          this.tokenSwap,
          this.authority,
          userTransferAuthority.publicKey,
          userAccountA,
          userAccountB,
          this.tokenAccountA,
          this.tokenAccountB,
          this.poolToken,
          poolAccount,
          this.swapProgramId,
          this.tokenProgramId,
          poolTokenAmount,
          maximumTokenA,
          maximumTokenB,
        ),
      ),
      this.payer,
      userTransferAuthority,
    );
  }

  static depositAllTokenTypesInstruction(
    tokenSwap: PublicKey,
    authority: PublicKey,
    userTransferAuthority: PublicKey,
    sourceA: PublicKey,
    sourceB: PublicKey,
    intoA: PublicKey,
    intoB: PublicKey,
    poolToken: PublicKey,
    poolAccount: PublicKey,
    swapProgramId: PublicKey,
    tokenProgramId: PublicKey,
    poolTokenAmount: number | Numberu64,
    maximumTokenA: number | Numberu64,
    maximumTokenB: number | Numberu64,
  ): TransactionInstruction {
    const dataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      Layout.uint64('poolTokenAmount'),
      Layout.uint64('maximumTokenA'),
      Layout.uint64('maximumTokenB'),
    ]);

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        instruction: 2, // Deposit instruction
        poolTokenAmount: new Numberu64(poolTokenAmount).toBuffer(),
        maximumTokenA: new Numberu64(maximumTokenA).toBuffer(),
        maximumTokenB: new Numberu64(maximumTokenB).toBuffer(),
      },
      data,
    );

    const keys = [
      {pubkey: tokenSwap, isSigner: false, isWritable: false},
      {pubkey: authority, isSigner: false, isWritable: false},
      {pubkey: userTransferAuthority, isSigner: true, isWritable: false},
      {pubkey: sourceA, isSigner: false, isWritable: true},
      {pubkey: sourceB, isSigner: false, isWritable: true},
      {pubkey: intoA, isSigner: false, isWritable: true},
      {pubkey: intoB, isSigner: false, isWritable: true},
      {pubkey: poolToken, isSigner: false, isWritable: true},
      {pubkey: poolAccount, isSigner: false, isWritable: true},
      {pubkey: tokenProgramId, isSigner: false, isWritable: false},
    ];
    return new TransactionInstruction({
      keys,
      programId: swapProgramId,
      data,
    });
  }

  /**
   * Withdraw tokens from the pool
   *
   * @param userAccountA User account for token A
   * @param userAccountB User account for token B
   * @param poolAccount User account for pool token
   * @param userTransferAuthority Account delegated to transfer user's tokens
   * @param poolTokenAmount Amount of pool tokens to burn
   * @param minimumTokenA The minimum amount of token A to withdraw
   * @param minimumTokenB The minimum amount of token B to withdraw
   */
  async withdrawAllTokenTypes(
    userAccountA: PublicKey,
    userAccountB: PublicKey,
    poolAccount: PublicKey,
    userTransferAuthority: Keypair,
    poolTokenAmount: number | Numberu64,
    minimumTokenA: number | Numberu64,
    minimumTokenB: number | Numberu64,
  ): Promise<TransactionSignature> {
    return await sendAndConfirmTransaction(
      'withdraw',
      this.connection,
      new Transaction().add(
        TokenSwap.withdrawAllTokenTypesInstruction(
          this.tokenSwap,
          this.authority,
          userTransferAuthority.publicKey,
          this.poolToken,
          this.feeAccount,
          poolAccount,
          this.tokenAccountA,
          this.tokenAccountB,
          userAccountA,
          userAccountB,
          this.swapProgramId,
          this.tokenProgramId,
          poolTokenAmount,
          minimumTokenA,
          minimumTokenB,
        ),
      ),
      this.payer,
      userTransferAuthority,
    );
  }

  static withdrawAllTokenTypesInstruction(
    tokenSwap: PublicKey,
    authority: PublicKey,
    userTransferAuthority: PublicKey,
    poolMint: PublicKey,
    feeAccount: PublicKey,
    sourcePoolAccount: PublicKey,
    fromA: PublicKey,
    fromB: PublicKey,
    userAccountA: PublicKey,
    userAccountB: PublicKey,
    swapProgramId: PublicKey,
    tokenProgramId: PublicKey,
    poolTokenAmount: number | Numberu64,
    minimumTokenA: number | Numberu64,
    minimumTokenB: number | Numberu64,
  ): TransactionInstruction {
    const dataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      Layout.uint64('poolTokenAmount'),
      Layout.uint64('minimumTokenA'),
      Layout.uint64('minimumTokenB'),
    ]);

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        instruction: 3, // Withdraw instruction
        poolTokenAmount: new Numberu64(poolTokenAmount).toBuffer(),
        minimumTokenA: new Numberu64(minimumTokenA).toBuffer(),
        minimumTokenB: new Numberu64(minimumTokenB).toBuffer(),
      },
      data,
    );

    const keys = [
      {pubkey: tokenSwap, isSigner: false, isWritable: false},
      {pubkey: authority, isSigner: false, isWritable: false},
      {pubkey: userTransferAuthority, isSigner: true, isWritable: false},
      {pubkey: poolMint, isSigner: false, isWritable: true},
      {pubkey: sourcePoolAccount, isSigner: false, isWritable: true},
      {pubkey: fromA, isSigner: false, isWritable: true},
      {pubkey: fromB, isSigner: false, isWritable: true},
      {pubkey: userAccountA, isSigner: false, isWritable: true},
      {pubkey: userAccountB, isSigner: false, isWritable: true},
      {pubkey: feeAccount, isSigner: false, isWritable: true},
      {pubkey: tokenProgramId, isSigner: false, isWritable: false},
    ];
    return new TransactionInstruction({
      keys,
      programId: swapProgramId,
      data,
    });
  }

  /**
   * Deposit one side of tokens into the pool
   * @param userAccount User account to deposit token A or B
   * @param poolAccount User account to receive pool tokens
   * @param userTransferAuthority Account delegated to transfer user's tokens
   * @param sourceTokenAmount The amount of token A or B to deposit
   * @param minimumPoolTokenAmount Minimum amount of pool tokens to mint
   */
  async depositSingleTokenTypeExactAmountIn(
    userAccount: PublicKey,
    poolAccount: PublicKey,
    userTransferAuthority: Keypair,
    sourceTokenAmount: number | Numberu64,
    minimumPoolTokenAmount: number | Numberu64,
  ): Promise<TransactionSignature> {
    return await sendAndConfirmTransaction(
      'depositSingleTokenTypeExactAmountIn',
      this.connection,
      new Transaction().add(
        TokenSwap.depositSingleTokenTypeExactAmountInInstruction(
          this.tokenSwap,
          this.authority,
          userTransferAuthority.publicKey,
          userAccount,
          this.tokenAccountA,
          this.tokenAccountB,
          this.poolToken,
          poolAccount,
          this.swapProgramId,
          this.tokenProgramId,
          sourceTokenAmount,
          minimumPoolTokenAmount,
        ),
      ),
      this.payer,
      userTransferAuthority,
    );
  }

  static depositSingleTokenTypeExactAmountInInstruction(
    tokenSwap: PublicKey,
    authority: PublicKey,
    userTransferAuthority: PublicKey,
    source: PublicKey,
    intoA: PublicKey,
    intoB: PublicKey,
    poolToken: PublicKey,
    poolAccount: PublicKey,
    swapProgramId: PublicKey,
    tokenProgramId: PublicKey,
    sourceTokenAmount: number | Numberu64,
    minimumPoolTokenAmount: number | Numberu64,
  ): TransactionInstruction {
    const dataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      Layout.uint64('sourceTokenAmount'),
      Layout.uint64('minimumPoolTokenAmount'),
    ]);

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        instruction: 4, // depositSingleTokenTypeExactAmountIn instruction
        sourceTokenAmount: new Numberu64(sourceTokenAmount).toBuffer(),
        minimumPoolTokenAmount: new Numberu64(
          minimumPoolTokenAmount,
        ).toBuffer(),
      },
      data,
    );

    const keys = [
      {pubkey: tokenSwap, isSigner: false, isWritable: false},
      {pubkey: authority, isSigner: false, isWritable: false},
      {pubkey: userTransferAuthority, isSigner: true, isWritable: false},
      {pubkey: source, isSigner: false, isWritable: true},
      {pubkey: intoA, isSigner: false, isWritable: true},
      {pubkey: intoB, isSigner: false, isWritable: true},
      {pubkey: poolToken, isSigner: false, isWritable: true},
      {pubkey: poolAccount, isSigner: false, isWritable: true},
      {pubkey: tokenProgramId, isSigner: false, isWritable: false},
    ];
    return new TransactionInstruction({
      keys,
      programId: swapProgramId,
      data,
    });
  }

  /**
   * Withdraw tokens from the pool
   *
   * @param userAccount User account to receive token A or B
   * @param poolAccount User account to burn pool token
   * @param userTransferAuthority Account delegated to transfer user's tokens
   * @param destinationTokenAmount The amount of token A or B to withdraw
   * @param maximumPoolTokenAmount Maximum amount of pool tokens to burn
   */
  async withdrawSingleTokenTypeExactAmountOut(
    userAccount: PublicKey,
    poolAccount: PublicKey,
    userTransferAuthority: Keypair,
    destinationTokenAmount: number | Numberu64,
    maximumPoolTokenAmount: number | Numberu64,
  ): Promise<TransactionSignature> {
    return await sendAndConfirmTransaction(
      'withdrawSingleTokenTypeExactAmountOut',
      this.connection,
      new Transaction().add(
        TokenSwap.withdrawSingleTokenTypeExactAmountOutInstruction(
          this.tokenSwap,
          this.authority,
          userTransferAuthority.publicKey,
          this.poolToken,
          this.feeAccount,
          poolAccount,
          this.tokenAccountA,
          this.tokenAccountB,
          userAccount,
          this.swapProgramId,
          this.tokenProgramId,
          destinationTokenAmount,
          maximumPoolTokenAmount,
        ),
      ),
      this.payer,
      userTransferAuthority,
    );
  }

  static withdrawSingleTokenTypeExactAmountOutInstruction(
    tokenSwap: PublicKey,
    authority: PublicKey,
    userTransferAuthority: PublicKey,
    poolMint: PublicKey,
    feeAccount: PublicKey,
    sourcePoolAccount: PublicKey,
    fromA: PublicKey,
    fromB: PublicKey,
    userAccount: PublicKey,
    swapProgramId: PublicKey,
    tokenProgramId: PublicKey,
    destinationTokenAmount: number | Numberu64,
    maximumPoolTokenAmount: number | Numberu64,
  ): TransactionInstruction {
    const dataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      Layout.uint64('destinationTokenAmount'),
      Layout.uint64('maximumPoolTokenAmount'),
    ]);

    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        instruction: 5, // withdrawSingleTokenTypeExactAmountOut instruction
        destinationTokenAmount: new Numberu64(
          destinationTokenAmount,
        ).toBuffer(),
        maximumPoolTokenAmount: new Numberu64(
          maximumPoolTokenAmount,
        ).toBuffer(),
      },
      data,
    );

    const keys = [
      {pubkey: tokenSwap, isSigner: false, isWritable: false},
      {pubkey: authority, isSigner: false, isWritable: false},
      {pubkey: userTransferAuthority, isSigner: true, isWritable: false},
      {pubkey: poolMint, isSigner: false, isWritable: true},
      {pubkey: sourcePoolAccount, isSigner: false, isWritable: true},
      {pubkey: fromA, isSigner: false, isWritable: true},
      {pubkey: fromB, isSigner: false, isWritable: true},
      {pubkey: userAccount, isSigner: false, isWritable: true},
      {pubkey: feeAccount, isSigner: false, isWritable: true},
      {pubkey: tokenProgramId, isSigner: false, isWritable: false},
    ];
    return new TransactionInstruction({
      keys,
      programId: swapProgramId,
      data,
    });
  }
}
