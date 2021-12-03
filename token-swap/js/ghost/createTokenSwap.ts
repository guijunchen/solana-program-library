import {
    Keypair,
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
  } from '@solana/web3.js';
import {AccountLayout, Token, TOKEN_PROGRAM_ID} from '@solana/spl-token';

import {TokenSwap, CurveType, TOKEN_SWAP_PROGRAM_ID} from '../src';
import {Numberu64} from '../dist';
import {newAccountWithLamports, newAccountWithLamportsOrFromFile, newAccountOrFromFile} from '../src/util/new-account-with-lamports';
import {sleep} from '../src/util/sleep';
import {sendAndConfirmTransaction} from '../src/util/send-and-confirm-transaction';

let url = 'http://localhost:8899';

// The following globals are created by `createTokenSwap` and used by subsequent tests
// Token swap
let tokenSwap: TokenSwap;
// authority of the token and Keypair
let authority: PublicKey;
// bump seed used to generate the authority public key
let bumpSeed: number;
// owner of the user Keypair
let owner: Keypair;

// Token pool
let tokenPool: Token;
let tokenAccountPool: PublicKey;
let feeAccount: PublicKey;

// Tokens swapped
let mintA: Token;
let mintB: Token;
let tokenAccountA: PublicKey;
let tokenAccountB: PublicKey;

// Hard-coded fee address, for testing production mode
const SWAP_PROGRAM_OWNER_FEE_ADDRESS =
  process.env.SWAP_PROGRAM_OWNER_FEE_ADDRESS;

// Initial amount in each swap token
let currentSwapTokenA = 1000000;
let currentSwapTokenB = 1000000;
let currentFeeAmount = 0;

//这几个变量定义没有搞清楚
const TRADING_FEE_NUMERATOR = 25;
const TRADING_FEE_DENOMINATOR = 10000;
const OWNER_TRADING_FEE_NUMERATOR = 5;
const OWNER_TRADING_FEE_DENOMINATOR = 10000;
const OWNER_WITHDRAW_FEE_NUMERATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 1;
const OWNER_WITHDRAW_FEE_DENOMINATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 6;
const HOST_FEE_NUMERATOR = 20;
const HOST_FEE_DENOMINATOR = 100;

// Swap instruction constants
// Because there is no withdraw fee in the production version, these numbers
// need to get slightly tweaked in the two cases.
const SWAP_AMOUNT_IN = 100000;
const SWAP_AMOUNT_OUT = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 90661 : 90674;
const SWAP_FEE = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 22273 : 22277;
const HOST_SWAP_FEE = SWAP_PROGRAM_OWNER_FEE_ADDRESS
  ? Math.floor((SWAP_FEE * HOST_FEE_NUMERATOR) / HOST_FEE_DENOMINATOR)
  : 0;
const OWNER_SWAP_FEE = SWAP_FEE - HOST_SWAP_FEE;

// Pool token amount minted on init
const DEFAULT_POOL_TOKEN_AMOUNT = 1000000000;
// Pool token amount to withdraw / deposit
const POOL_TOKEN_AMOUNT = 10000000;

const keyFileDir = "testlocalnet";


function assert(condition: boolean, message?: string) {
    if (!condition) {
      console.log(Error().stack + ':token-test.js');
      throw message || 'Assertion failed';
    }
}

let connection: Connection;
async function getConnection(): Promise<Connection> {
  if (connection) return connection;

  connection = new Connection(url, 'recent');
  const version = await connection.getVersion();

  console.log('Connection to cluster established:', url, version);
  return connection;
}

export async function createTokenSwap(
    curveType: number,
    curveParameters?: Numberu64,
  ): Promise<void> {
    const connection = await getConnection();
    //payer 钱包账号并且有空投币1000000000 payer.key
    // const payer = await newAccountWithLamports(connection, 1000000000);
    const payer =await newAccountWithLamportsOrFromFile(connection, 1000000000, keyFileDir, "payer.key");
    console.log("payer wallet accout public key ->:", payer.publicKey.toBase58());

    //owner 钱包账号并且有空投币1000000000 owner.key
    // owner = await newAccountWithLamports(connection, 1000000000);
    owner =await newAccountWithLamportsOrFromFile(connection, 1000000000, keyFileDir, "owner.key");
    console.log("owner wallet accout public key ->:", owner.publicKey.toBase58());

    //tokenSwapAccount 钱包账户 //这个才是真正createTokenSwap的地址 tokenSwapAccount.key
    // const tokenSwapAccount = new Keypair();
    const tokenSwapAccount = await newAccountOrFromFile(connection, "testlocalnet", "tokenSwapAccount.key");
    console.log("tokenswapaccount wallet account public key: ->", tokenSwapAccount.publicKey.toBase58());
  
    //authority bumpSeed 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址和随机数: authority bumpSeed
    //authority bumpSeed 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址和随机数 [authority, bumpSeed] = await PublicKey.findProgramAddress([tokenSwapAccount.publicKey.toBuffer()],TOKEN_SWAP_PROGRAM_ID,);
    [authority, bumpSeed] = await PublicKey.findProgramAddress(
      [tokenSwapAccount.publicKey.toBuffer()],
      TOKEN_SWAP_PROGRAM_ID,
    );
    console.log("authority address", authority.toBase58());
    console.log("bumpSeed", bumpSeed);
  
    //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
    //这个感觉是这个池子的代币  //tokenSwapAccount池子钱包账户
    //使用get accout info 获取一下信息看看
    console.log('creating pool mint');
    tokenPool = await Token.createMint(
      connection,
      payer,
      authority,
      null,
      2,
      TOKEN_PROGRAM_ID,
    );
    
    console.log("tokenPool publickey:", tokenPool.publicKey.toBase58());
  
    //创建账户，之前只是生成钱包，还没创建账户
    //tokenAccountPool 创建own对tokenPool mint的账户:tokenPool.createAccount(owner.publicKey);
    //这个不是创建关联账户的方法
    console.log('creating pool account');
    tokenAccountPool = await tokenPool.createAccount(owner.publicKey);
    console.log("tokenAccountPool public key:", tokenAccountPool.toBase58());
    const ownerKey = SWAP_PROGRAM_OWNER_FEE_ADDRESS || owner.publicKey.toString();
    //feeAccount 创建own对tokenPool mint的账户:tokenPool.createAccount(new PublicKey(ownerKey))
    feeAccount = await tokenPool.createAccount(new PublicKey(ownerKey)); //创建费用账户？
    console.log("feeAccount public key:", feeAccount.toBase58());
  
    //mintA 创建token A mint Token.createMint(payer,owner.publicKey)
    //创建token A //就算payer， owner一样，每次创建都不一样，说明同一个密钥可以创建多个mint
    // tokenA 
    console.log('creating token A');
    mintA = await Token.createMint(
      connection,
      payer,
      owner.publicKey,
      null,
      2,
      TOKEN_PROGRAM_ID,
    );
    mintA.getOrCreateAssociatedAccountInfo(owner.publicKey)
    console.log("mintA publickey:", mintA.publicKey.toBase58());
  
    //tokenAccountA 创建authority对mintA的账户:tokenAccountA
    console.log('creating token A account');
    tokenAccountA = await mintA.createAccount(authority);
    console.log("tokenAccountA public key:", tokenAccountA.toBase58());
    console.log('minting token A to swap');
    await mintA.mintTo(tokenAccountA, owner, [], currentSwapTokenA);
  
    //mintB 创建token B mint Token.createMint(payer,owner.publicKey): mintB
    //创建token B
    console.log('creating token B');
    mintB = await Token.createMint(
      connection,
      payer,
      owner.publicKey,
      null,
      2,
      TOKEN_PROGRAM_ID,
    );
    console.log("mintB publickey:", mintB.publicKey.toBase58());
  
    //tokenAccountB 创建authority对mintB的关联账户:tokenAccountB
    console.log('creating token B account');
    tokenAccountB = await mintB.createAccount(authority);
    console.log("tokenAccountB public key:", tokenAccountB.toBase58());
    console.log('minting token B to swap');
    await mintB.mintTo(tokenAccountB, owner, [], currentSwapTokenB);
  
    console.log('creating token swap');
    // const swapPayer = await newAccountWithLamports(connection, 10000000000);
    //swapPayer 钱包账号并且有空投币1000000000 swapPayer.key
    const swapPayer =await newAccountWithLamportsOrFromFile(connection, 1000000000, keyFileDir, "swapPayer.key");
    tokenSwap = await TokenSwap.createTokenSwap(
      connection, //连接
      swapPayer, //swapPayer 钱包账号并且有空投币1000000000
      tokenSwapAccount, //tokenSwapAccount 钱包账户 这个才是真正createTokenSwap的地址 tokenSwapAccount.key
      authority, //authority 创建tokenSwapAccount钱包账户和TOKEN_SWAP_PROGRAM_ID program的派生地址
      tokenAccountA, //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
      tokenAccountB, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
      tokenPool.publicKey, //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
      mintA.publicKey, //mintA 创建token A mint Token.createMint(payer,owner.publicKey)
      mintB.publicKey, //mintB 创建token B mint Token.createMint(payer,owner.publicKey)
      feeAccount, //feeAccount 创建own对tokenPool mint的关联账户:tokenPool.createAccount(new PublicKey(ownerKey))
      tokenAccountPool, //tokenAccountPool 创建own对tokenPool mint的关联账户:tokenPool.createAccount(owner.publicKey);
      TOKEN_SWAP_PROGRAM_ID, //swap 合约地址
      TOKEN_PROGRAM_ID, // token 合约地址
      TRADING_FEE_NUMERATOR, //TRADING_FEE_NUMERATOR = 25;
      TRADING_FEE_DENOMINATOR, //TRADING_FEE_DENOMINATOR = 10000;
      OWNER_TRADING_FEE_NUMERATOR, //OWNER_TRADING_FEE_NUMERATOR = 5;
      OWNER_TRADING_FEE_DENOMINATOR, //OWNER_TRADING_FEE_DENOMINATOR = 10000;
      OWNER_WITHDRAW_FEE_NUMERATOR, //OWNER_WITHDRAW_FEE_NUMERATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 1;1
      OWNER_WITHDRAW_FEE_DENOMINATOR,//OWNER_WITHDRAW_FEE_DENOMINATOR = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 0 : 6;6
      HOST_FEE_NUMERATOR, //HOST_FEE_NUMERATOR = 20;
      HOST_FEE_DENOMINATOR, //HOST_FEE_DENOMINATOR = 100;
      curveType, //CurveType.ConstantPrice
      curveParameters, //new Numberu64(1)
    );
  
    console.log('loading token swap');
    const fetchedTokenSwap = await TokenSwap.loadTokenSwap(
      connection,
      tokenSwapAccount.publicKey,
      TOKEN_SWAP_PROGRAM_ID,
      swapPayer,
    );
  
    assert(fetchedTokenSwap.tokenProgramId.equals(TOKEN_PROGRAM_ID));
    assert(fetchedTokenSwap.tokenAccountA.equals(tokenAccountA));
    assert(fetchedTokenSwap.tokenAccountB.equals(tokenAccountB));
    assert(fetchedTokenSwap.mintA.equals(mintA.publicKey));
    assert(fetchedTokenSwap.mintB.equals(mintB.publicKey));
    assert(fetchedTokenSwap.poolToken.equals(tokenPool.publicKey));
    assert(fetchedTokenSwap.feeAccount.equals(feeAccount));
    assert(
      TRADING_FEE_NUMERATOR == fetchedTokenSwap.tradeFeeNumerator.toNumber(),
    );
    assert(
      TRADING_FEE_DENOMINATOR == fetchedTokenSwap.tradeFeeDenominator.toNumber(),
    );
    assert(
      OWNER_TRADING_FEE_NUMERATOR ==
        fetchedTokenSwap.ownerTradeFeeNumerator.toNumber(),
    );
    assert(
      OWNER_TRADING_FEE_DENOMINATOR ==
        fetchedTokenSwap.ownerTradeFeeDenominator.toNumber(),
    );
    assert(
      OWNER_WITHDRAW_FEE_NUMERATOR ==
        fetchedTokenSwap.ownerWithdrawFeeNumerator.toNumber(),
    );
    assert(
      OWNER_WITHDRAW_FEE_DENOMINATOR ==
        fetchedTokenSwap.ownerWithdrawFeeDenominator.toNumber(),
    );
    assert(HOST_FEE_NUMERATOR == fetchedTokenSwap.hostFeeNumerator.toNumber());
    assert(
      HOST_FEE_DENOMINATOR == fetchedTokenSwap.hostFeeDenominator.toNumber(),
    );
    assert(curveType == fetchedTokenSwap.curveType);
  }


//todo
export async function loadTokenSwap(
  curveType: number,
  curveParameters?: Numberu64,
): Promise<void> {
  const connection = await getConnection();

  //tokenSwapAccount 钱包账户 //这个才是真正createTokenSwap的地址 tokenSwapAccount.key
  // const tokenSwapAccount = new Keypair();
  const tokenSwapAccount = await newAccountOrFromFile(connection, "testlocalnet", "tokenSwapAccount.key");
  console.log("tokenswapaccount wallet account public key: ->", tokenSwapAccount.publicKey.toBase58());

  // const swapPayer = await newAccountWithLamports(connection, 10000000000);
  //swapPayer 钱包账号并且有空投币1000000000 swapPayer.key
  const swapPayer =await newAccountWithLamportsOrFromFile(connection, 1000000000, keyFileDir, "swapPayer.key");

  console.log('loading token swap');
  const fetchedTokenSwap = await TokenSwap.loadTokenSwap(
    connection,
    tokenSwapAccount.publicKey,
    TOKEN_SWAP_PROGRAM_ID,
    swapPayer,
  );

  assert(fetchedTokenSwap.tokenProgramId.equals(TOKEN_PROGRAM_ID));
  console.log("fetchedTokenSwap.tokenProgramId:", fetchedTokenSwap.tokenProgramId);
  assert(fetchedTokenSwap.tokenAccountA.equals(tokenAccountA));
  console.log("fetchedTokenSwap.tokenAccountA:", fetchedTokenSwap.tokenAccountA.toBase58());
  assert(fetchedTokenSwap.tokenAccountB.equals(tokenAccountB));
  assert(fetchedTokenSwap.mintA.equals(mintA.publicKey));
  assert(fetchedTokenSwap.mintB.equals(mintB.publicKey));
  assert(fetchedTokenSwap.poolToken.equals(tokenPool.publicKey));
  assert(fetchedTokenSwap.feeAccount.equals(feeAccount));
  assert(
    TRADING_FEE_NUMERATOR == fetchedTokenSwap.tradeFeeNumerator.toNumber(),
  );
  assert(
    TRADING_FEE_DENOMINATOR == fetchedTokenSwap.tradeFeeDenominator.toNumber(),
  );
  assert(
    OWNER_TRADING_FEE_NUMERATOR ==
      fetchedTokenSwap.ownerTradeFeeNumerator.toNumber(),
  );
  assert(
    OWNER_TRADING_FEE_DENOMINATOR ==
      fetchedTokenSwap.ownerTradeFeeDenominator.toNumber(),
  );
  assert(
    OWNER_WITHDRAW_FEE_NUMERATOR ==
      fetchedTokenSwap.ownerWithdrawFeeNumerator.toNumber(),
  );
  assert(
    OWNER_WITHDRAW_FEE_DENOMINATOR ==
      fetchedTokenSwap.ownerWithdrawFeeDenominator.toNumber(),
  );
  assert(HOST_FEE_NUMERATOR == fetchedTokenSwap.hostFeeNumerator.toNumber());
  assert(
    HOST_FEE_DENOMINATOR == fetchedTokenSwap.hostFeeDenominator.toNumber(),
  );
  assert(curveType == fetchedTokenSwap.curveType);
} 


export async function depositAllTokenTypes(): Promise<void> {
   //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
   //看这个币数据
  const poolMintInfo = await tokenPool.getMintInfo();
  // console.log("poolMintInfo mintAuthority:", poolMintInfo.mintAuthority.toBase58())
  const supply = poolMintInfo.supply.toNumber();
  console.log("supply:", supply)

   //mintA 创建token A mint Token.createMint(payer,owner.publicKey)
   //从账户中获取信息查看币数量 计算价格
  const swapTokenA = await mintA.getAccountInfo(tokenAccountA);
  console.log("swapTokenA address:", swapTokenA.address.toBase58())
  //算价格，怎么是和supply计算价格
  const tokenA = Math.floor(
    (swapTokenA.amount.toNumber() * POOL_TOKEN_AMOUNT) / supply,
  );
  console.log("tokenA:", tokenA);

  //mintB 创建token B mint Token.createMint(payer,owner.publicKey)
   //从账户中获取信息查看币数量 计算价格
  const swapTokenB = await mintB.getAccountInfo(tokenAccountB);
  console.log("swapTokenB address:", swapTokenB.address.toBase58())
  const tokenB = Math.floor(
    (swapTokenB.amount.toNumber() * POOL_TOKEN_AMOUNT) / supply,
  );
  console.log("tokenB:", tokenB);

  //创建owner对mintA depositor账户币提供对应数量tokenA
  const userTransferAuthority = Keypair.generate();
  console.log("userTransferAuthority public key:", userTransferAuthority.publicKey.toBase58())
  console.log('Creating depositor token a account');
  //创建owner对mintA depositor账户
  const userAccountA = await mintA.createAccount(owner.publicKey);
  //给userAccountA发币
  await mintA.mintTo(userAccountA, owner, [], tokenA);
  //授权
  await mintA.approve(
    userAccountA,
    userTransferAuthority.publicKey,
    owner,
    [],
    tokenA,
  );

  //创建owner对mintB depositor账户币提供对应数量tokenB
  console.log('Creating depositor token b account');
  //创建owner对 mintB depositor账户
  const userAccountB = await mintB.createAccount(owner.publicKey);
  await mintB.mintTo(userAccountB, owner, [], tokenB);
  await mintB.approve(
    userAccountB,
    userTransferAuthority.publicKey,
    owner,
    [],
    tokenB,
  );

  console.log('Creating depositor pool token account');
  //创建owner对 tokenPool mint depositor账户
  const newAccountPool = await tokenPool.createAccount(owner.publicKey);

  console.log('Depositing into swap');
  await tokenSwap.depositAllTokenTypes(
    userAccountA,
    userAccountB,
    newAccountPool,
    userTransferAuthority,
    POOL_TOKEN_AMOUNT,
    tokenA,
    tokenB,
  );

  let info;
  //userAccountA 对于mintA的币全部存进去了
  info = await mintA.getAccountInfo(userAccountA);
  assert(info.amount.toNumber() == 0);
  console.log("userAccountA mintA.getAccountInfo amount:", info.amount.toNumber());
  //userAccountB 对于mintB的币全部存进去了
  info = await mintB.getAccountInfo(userAccountB);
  assert(info.amount.toNumber() == 0);
  console.log("userAccountB mintB.getAccountInfo amount:", info.amount.toNumber());

  //tokenAccountA 对于mintA的币接收了userAccountA的tokenA个币
  info = await mintA.getAccountInfo(tokenAccountA);
  assert(info.amount.toNumber() == currentSwapTokenA + tokenA);
  console.log("tokenAccountA mintA.getAccountInfo amount:", info.amount.toNumber());
  currentSwapTokenA += tokenA;

  //tokenAccountB 对于mintA的币接收了userAccountB的tokenB个币
  info = await mintB.getAccountInfo(tokenAccountB);
  assert(info.amount.toNumber() == currentSwapTokenB + tokenB);
  console.log("tokenAccountB mintB.getAccountInfo amount:", info.amount.toNumber());
  currentSwapTokenB += tokenB;

  //这个待分析
  info = await tokenPool.getAccountInfo(newAccountPool);
  assert(info.amount.toNumber() == POOL_TOKEN_AMOUNT);
  console.log("newAccountPool tokenPool.getAccountInfo info.amount.toNumber():", info.amount.toNumber());
}


export async function withdrawAllTokenTypes(): Promise<void> {
  //tokenPool 创建pool的币，这个逻辑有点不清楚待分析 Token.createMint(payer, authority)
   //看这个币数据
  const poolMintInfo = await tokenPool.getMintInfo();
  const supply = poolMintInfo.supply.toNumber();
  console.log("supply:", supply)

  //mintA 创建token A mint Token.createMint(payer,owner.publicKey)
   //从账户中获取信息查看币数量 计算价格
  let swapTokenA = await mintA.getAccountInfo(tokenAccountA);
  console.log("swapTokenA address:", swapTokenA.address.toBase58());

  //mintB 创建token B mint Token.createMint(payer,owner.publicKey)
   //从账户中获取信息查看币数量 计算价格
  let swapTokenB = await mintB.getAccountInfo(tokenAccountB);
  console.log("swapTokenB address:", swapTokenB.address.toBase58());
  let feeAmount = 0;
  if (OWNER_WITHDRAW_FEE_NUMERATOR !== 0) {
    feeAmount = Math.floor(
      (POOL_TOKEN_AMOUNT * OWNER_WITHDRAW_FEE_NUMERATOR) /
        OWNER_WITHDRAW_FEE_DENOMINATOR,
    );
  }
  const poolTokenAmount = POOL_TOKEN_AMOUNT - feeAmount;
  const tokenA = Math.floor(
    (swapTokenA.amount.toNumber() * poolTokenAmount) / supply,
  );
  console.log("tokenA:", tokenA);
  const tokenB = Math.floor(
    (swapTokenB.amount.toNumber() * poolTokenAmount) / supply,
  );
  console.log("tokenB:", tokenB);

  //创建owner对mintA withdraw账户
  console.log('Creating withdraw token A account');
  let userAccountA = await mintA.createAccount(owner.publicKey);
  console.log('Creating withdraw token B account');
  //创建owner对mintB withdraw账户
  let userAccountB = await mintB.createAccount(owner.publicKey);

  //创建owner对 tokenPool mint withdrawal账户
  const userTransferAuthority = Keypair.generate();
  console.log('Approving withdrawal from pool account');
  await tokenPool.approve(
    tokenAccountPool,
    userTransferAuthority.publicKey,
    owner,
    [],
    POOL_TOKEN_AMOUNT,
  );

  console.log('Withdrawing pool tokens for A and B tokens');
  await tokenSwap.withdrawAllTokenTypes(
    userAccountA,
    userAccountB,
    tokenAccountPool,
    userTransferAuthority,
    POOL_TOKEN_AMOUNT,
    tokenA,
    tokenB,
  );

  //const poolMintInfo = await tokenPool.getMintInfo();
  swapTokenA = await mintA.getAccountInfo(tokenAccountA);
  swapTokenB = await mintB.getAccountInfo(tokenAccountB);

  let info = await tokenPool.getAccountInfo(tokenAccountPool);
  assert(
    info.amount.toNumber() == DEFAULT_POOL_TOKEN_AMOUNT - POOL_TOKEN_AMOUNT,
  );
  console.log("tokenAccountPool tokenPool.getAccountInfo.amount.toNumber():",info.amount.toNumber());
  assert(swapTokenA.amount.toNumber() == currentSwapTokenA - tokenA);
  console.log("tokenAccountA mintA.getAccountInf swapTokenA.amount.toNumber():",swapTokenA.amount.toNumber());
  currentSwapTokenA -= tokenA;
  assert(swapTokenB.amount.toNumber() == currentSwapTokenB - tokenB);
  console.log("tokenAccountB mintB.getAccountInf swapTokenB.amount.toNumber():",swapTokenB.amount.toNumber());
  currentSwapTokenB -= tokenB;

  info = await mintA.getAccountInfo(userAccountA);
  assert(info.amount.toNumber() == tokenA);
  console.log("userAccountA mintA.getAccountInfo info.amount.toNumber():", info.amount.toNumber());
  info = await mintB.getAccountInfo(userAccountB);
  assert(info.amount.toNumber() == tokenB);
  console.log("userAccountB mintB.getAccountInfo info.amount.toNumber():", info.amount.toNumber());
  info = await tokenPool.getAccountInfo(feeAccount);
  assert(info.amount.toNumber() == feeAmount);
  console.log("feeAccount tokenPool.getAccountInfo() info.amount.toNumber():", info.amount.toNumber())
  currentFeeAmount = feeAmount;
}

export async function swap(): Promise<void> {
  console.log('Creating swap token a account');
  // owner可以确定是币的拥有者也是需要swap换币的人
  //userAccountA 创建owner对mintA swap账户并征发一定数量的币mintA.createAccount(owner.publicKey)|mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);
  let userAccountA = await mintA.createAccount(owner.publicKey);
  await mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);
  console.log("userAccountA  public key:", userAccountA.toBase58());

  // userTransferAuthority Keypair.generate();mintA.approve(userAccountA,userTransferAuthority.publicKey,owner,[],SWAP_AMOUNT_IN,);
  const userTransferAuthority = Keypair.generate();
  await mintA.approve(
    userAccountA,
    userTransferAuthority.publicKey,
    owner,
    [],
    SWAP_AMOUNT_IN,
  );

  console.log('Creating swap token b account');
  //userAccountB 创建owner对mintB swap账户 mintB.createAccount(owner.publicKey);
  let userAccountB = await mintB.createAccount(owner.publicKey);
  console.log("userAccountB  public key:", userAccountB.toBase58());

  //创建owner对tokenPool mint swap账户 SWAP_PROGRAM_OWNER_FEE_ADDRESS ? await tokenPool.createAccount(owner.publicKey): null;
  let poolAccount = SWAP_PROGRAM_OWNER_FEE_ADDRESS
    ? await tokenPool.createAccount(owner.publicKey)
    : null;

  console.log('Swapping');
  await tokenSwap.swap(
    userAccountA, //userAccountA 创建owner对mintA swap账户并征发一定数量的币mintA.createAccount(owner.publicKey)|mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);
    tokenAccountA, //tokenAccountA 创建authority对mintA的账户:mintA.createAccount(authority);
    tokenAccountB, //tokenAccountB 创建authority对mintB的账户:mintB.createAccount(authority);
    userAccountB, //userAccountB 创建owner对mintB swap账户 mintB.createAccount(owner.publicKey);
    poolAccount, //应该是费用账户｜创建owner对tokenPool mint swap账户 SWAP_PROGRAM_OWNER_FEE_ADDRESS ? await tokenPool.createAccount(owner.publicKey): null;
    userTransferAuthority,// userTransferAuthority Keypair.generate();mintA.approve(userAccountA,userTransferAuthority.publicKey,owner,[],SWAP_AMOUNT_IN,);
    SWAP_AMOUNT_IN, //SWAP_AMOUNT_IN = 100000;
    SWAP_AMOUNT_OUT, //SWAP_AMOUNT_OUT = SWAP_PROGRAM_OWNER_FEE_ADDRESS ? 90661 : 90674;
  );

  await sleep(500);

  let info;
  info = await mintA.getAccountInfo(userAccountA);
  console.log("userAccountA mintA.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());
  assert(info.amount.toNumber() == 0);
  console.log("userAccountA mintA.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());

  info = await mintB.getAccountInfo(userAccountB);
  console.log("userAccountB mintB.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());
  // assert(info.amount.toNumber() == SWAP_AMOUNT_OUT); //99700
  console.log("userAccountB mintB.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());

  info = await mintA.getAccountInfo(tokenAccountA);
  assert(info.amount.toNumber() == currentSwapTokenA + SWAP_AMOUNT_IN);
  currentSwapTokenA += SWAP_AMOUNT_IN;
  console.log("tokenAccountA mintA.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());

  info = await mintB.getAccountInfo(tokenAccountB);
  // assert(info.amount.toNumber() == currentSwapTokenB - SWAP_AMOUNT_OUT);
  currentSwapTokenB -= SWAP_AMOUNT_OUT;
  console.log("tokenAccountB mintB.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());

  info = await tokenPool.getAccountInfo(tokenAccountPool);
  // assert(
  //   info.amount.toNumber() == DEFAULT_POOL_TOKEN_AMOUNT - POOL_TOKEN_AMOUNT,
  // );
  console.log("tokenAccountPool tokenPool.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());

  info = await tokenPool.getAccountInfo(feeAccount);
  // assert(info.amount.toNumber() == currentFeeAmount + OWNER_SWAP_FEE);
  console.log("feeAccount tokenPool.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());

  if (poolAccount != null) {
    info = await tokenPool.getAccountInfo(poolAccount);
    // assert(info.amount.toNumber() == HOST_SWAP_FEE);
  }
  console.log("poolAccount tokenPool.getAccountInfo() info.amount.toNumber():", info.amount.toNumber());
}

export async function createAccountAndSwapAtomic(): Promise<void> {

  console.log('Creating swap token a account');
  //创建owner对mintA swap账户并征发一定数据的币
  //mintA.createAccount这个创建到底是不是关联账号呢，这个也是用来交易的
  let userAccountA = await mintA.createAccount(owner.publicKey);
  await mintA.mintTo(userAccountA, owner, [], SWAP_AMOUNT_IN);

  // @ts-ignore
  const balanceNeeded = await Token.getMinBalanceRentForExemptAccount(
    connection,
  );
  const newAccount = Keypair.generate();
  const transaction = new Transaction();
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: owner.publicKey,
      newAccountPubkey: newAccount.publicKey,
      lamports: balanceNeeded,
      space: AccountLayout.span,
      programId: mintB.programId,
    }),
  );

  transaction.add(
    Token.createInitAccountInstruction(
      mintB.programId,
      mintB.publicKey,
      newAccount.publicKey,
      owner.publicKey,
    ),
  );

  //授权
  const userTransferAuthority = Keypair.generate();
  transaction.add(
    Token.createApproveInstruction(
      mintA.programId,
      userAccountA,
      userTransferAuthority.publicKey,
      owner.publicKey,
      [owner],
      SWAP_AMOUNT_IN,
    ),
  );

  transaction.add(
    TokenSwap.swapInstruction(
      tokenSwap.tokenSwap,
      tokenSwap.authority,
      userTransferAuthority.publicKey,
      userAccountA,
      tokenSwap.tokenAccountA,
      tokenSwap.tokenAccountB,
      newAccount.publicKey,
      tokenSwap.poolToken,
      tokenSwap.feeAccount,
      null,
      tokenSwap.swapProgramId,
      tokenSwap.tokenProgramId,
      SWAP_AMOUNT_IN,
      0,
    ),
  );

  // Send the instructions
  console.log('sending big instruction');
  await sendAndConfirmTransaction(
    'create account, approve transfer, swap',
    connection,
    transaction,
    owner,
    newAccount,
    userTransferAuthority,
  );


  let info;
  info = await mintA.getAccountInfo(tokenAccountA);
  currentSwapTokenA = info.amount.toNumber();
  console.log("mintA.getAccountInfo(tokenAccountA): info.amount.toNumber()")
  info = await mintB.getAccountInfo(tokenAccountB);
  currentSwapTokenB = info.amount.toNumber();
  console.log("mintB.getAccountInfo(tokenAccountB): info.amount.toNumber()")
}
