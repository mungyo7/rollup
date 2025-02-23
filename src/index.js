require('dotenv').config();
const { ethers } = require('ethers');

// A, B 지갑 주소
const WATCHED_ADDRESSES = [
  '0x91531da8b72049038f911ad82c8a8540797d9792', // A
  '0x2643fe1e5fb3fdb1d0004b78fd91209a28904a18', // B
];

// 1. 프로바이더 설정 (예: Ethereum mainnet, Goerli 등)
const provider = new ethers.providers.JsonRpcProvider(
  `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`
);

const privateKey = process.env.PRIVATE_KEY;

// private key에서 0x 접두사 제거
const cleanPrivateKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;

// 2. 시퀀서의 지갑(프라이빗 키) 설정
const sequencerWallet = new ethers.Wallet(
    cleanPrivateKey,
    provider
);

// 3. 배포된 롤업 컨트랙트 인스턴스 가져오기
const rollupAbi = [
  'function submitBatch(bytes32 _compressedData) external',
];
const rollupContract = new ethers.Contract(
  process.env.ROLLUP_CONTRACT_ADDRESS,
  rollupAbi,
  sequencerWallet
);

// 4. 트랜잭션 구조체 정의
class Transaction {
  constructor(
    txhash,
    blocknumber,
    from,
    to,
    value,
    data,
    timestamp
  ) {
    this.txhash = txhash;
    this.blocknumber = blocknumber;
    this.from = from;
    this.to = to;
    this.value = value;
    this.data = data;
    this.timestamp = timestamp;
  }
}

// pendingTxs를 Transaction 객체 배열로 변경
let pendingTxs = [];

// 5. 새로운 블록이 생길 때마다, 혹은 필터를 통해 트랜잭션 감지
//    여기서는 예시로, 블록마다 해당 주소들로부터의 트랜잭션을 필터링하는 방식을 가정
provider.on('block', async (blockNumber) => {
  console.log(`\n[Sequencer] New block: ${blockNumber}`);
  
  // 블록에 포함된 트랜잭션 가져오기
  const block = await provider.getBlockWithTransactions(blockNumber);
  const transactions = block.transactions;

  // 이전 블록 해시와 상태 루트 가져오기
  const previousBlock = await provider.getBlock(blockNumber - 1);
  const previousBlockHash = previousBlock ? previousBlock.hash : null;
  const stateRoot = block.stateRoot;

  for (const tx of transactions) {
    // 단순히 to(수신자)가 A/B 지갑인지, 또는 from(송신자)가 A/B 지갑인지 필터링
    // 실제 사용 시에는 use-case에 따라 필터링 조건이 달라질 수 있음
    // console.log(tx.from);
    if (
      WATCHED_ADDRESSES.includes((tx.from || '').toLowerCase()) ||
      WATCHED_ADDRESSES.includes((tx.to || '').toLowerCase())
    ) {
      console.log(`[Detected] Tx from/to watched address => hash: ${tx.hash}`);
      
      // Transaction 객체 생성 및 저장
      const transaction = new Transaction(
        tx.hash,
        blockNumber,
        tx.from,
        tx.to,
        tx.value,
        tx.data,
        block.timestamp
      );
      pendingTxs.push(transaction);
      console.log(pendingTxs);
      // 3개가 모이면 batch로 압축 후 L1으로 전송
      if (pendingTxs.length >= 3) {
        await submitBatchToL1(pendingTxs.splice(0, 3)); // 앞에서 3개만 추출
      }
    }
  }
});

// 6. batch 제출 함수
async function submitBatchToL1(batchTxs) {
  console.log('\n[Sequencer] Submitting batch to L1...');
  console.log('Batch Txs:', batchTxs);

  // 구조화된 데이터를 RLP 인코딩 형식으로 변환
  const encodedData = batchTxs.map(tx => ({
    txhash: tx.txhash,
    blocknumber: tx.blocknumber.toString(),
    from: tx.from,
    to: tx.to,
    value: tx.value.toString(),
    data: tx.data,
    timestamp: tx.timestamp.toString()
  }));

  // 인코딩된 데이터를 JSON 문자열로 변환 후 해싱
  const compressedData = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(JSON.stringify(encodedData))
  );

  // Rollup 컨트랙트에 배치 제출
  const tx = await rollupContract.submitBatch(compressedData);
  console.log(`[Sequencer] Waiting for L1 confirmation... (tx: ${tx.hash})`);

  const receipt = await tx.wait();
  console.log('[Sequencer] Batch submitted! Gas used:', receipt.gasUsed.toString());
}
