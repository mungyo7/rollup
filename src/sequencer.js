require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

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

// 환경 변수 확인
if (!process.env.ROLLUP_CONTRACT_ADDRESS) {
  throw new Error('ROLLUP_CONTRACT_ADDRESS is not defined in .env file');
}

// 3. 배포된 롤업 컨트랙트 인스턴스 가져오기
const rollupAbi = [
  'function submitBatch(bytes32 _compressedData) external',
  'function challengeBatch(uint256 _batchIndex, bytes32 _newCompressedData) external',
  'function finalizeBatch(uint256 _batchIndex) external',
  'function getBatchStatus(uint256 _batchIndex) external view returns (uint8)',
  'event BatchSubmitted(uint256 batchIndex, bytes32 compressedData)',
  'event BatchChallenged(uint256 batchIndex, bytes32 newCompressedData)',
  'event BatchFinalized(uint256 batchIndex)'
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
      
      // 3개가 모이면 batch로 압축 후 L1으로 전송
      if (pendingTxs.length >= 3) {
        await submitBatchToL1(pendingTxs.splice(0, 3)); // 앞에서 3개만 추출
      }
    }
  }
});

// 배치 데이터 저장 경로 설정
const BATCH_DATA_DIR = path.join(__dirname, 'batch-data');
if (!fs.existsSync(BATCH_DATA_DIR)) {
  fs.mkdirSync(BATCH_DATA_DIR);
}

// 6. batch 제출 함수
async function submitBatchToL1(batchTxs) {
  console.log('\n[Sequencer] Submitting batch to L1...');
  console.log('Batch Txs:', batchTxs);

  // 상태 업데이트 데이터 구성
  const stateUpdates = batchTxs.map(tx => ({
    txhash: tx.txhash,
    sender: tx.from,
    recipient: tx.to,
    amount: tx.value.toString(),
    nonce: tx.blocknumber.toString(),
    timestamp: tx.timestamp.toString()
  }));

  // 원본 데이터를 JSON으로 직렬화
  const batchData = ethers.utils.defaultAbiCoder.encode(
    ['tuple(bytes32 txhash, address sender, address recipient, string amount, string nonce, string timestamp)[]'],
    [stateUpdates]
  );

  const leaves = stateUpdates.map(update => 
    ethers.utils.solidityKeccak256(
      ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
      [update.txhash, update.sender, update.recipient, update.amount, update.nonce, update.timestamp]
    )
  );

  const batchStateRoot = ethers.utils.solidityKeccak256(
    ['bytes32[]'],
    [leaves]
  );

  // Rollup 컨트랙트에 배치 제출
  const tx = await rollupContract.submitBatch(batchStateRoot);
  console.log('[Sequencer] StateRoot:', batchStateRoot);
  console.log(`[Sequencer] Waiting for L1 confirmation... (tx: ${tx.hash})`);

  const receipt = await tx.wait();
  console.log('[Sequencer] Batch submitted! Gas used:', receipt.gasUsed.toString());

  // BatchSubmitted 이벤트에서 batchIndex 가져오기
  const event = receipt.events.find(e => e.event === 'BatchSubmitted');
  const batchIndex = event.args.batchIndex.toNumber();

  // 배치 데이터를 파일로 저장할 때 batchIndex도 함께 저장
  const batchDataObj = {
    originalData: stateUpdates,
    timestamp: Date.now(),
    batchIndex: batchIndex,  // 배치 인덱스 추가
    finalized: false
  };
  
  const batchFilePath = path.join(BATCH_DATA_DIR, `${batchStateRoot}.json`);
  fs.writeFileSync(batchFilePath, JSON.stringify(batchDataObj, null, 2));

  console.log(`[Sequencer] Batch #${batchIndex} data saved`);

  // BatchSubmitted 이벤트 리스닝
  if (event) {
    console.log('\n[Sequencer] Batch data retrieval:');
    await getBatchDataByStateRoot(event.args.compressedData);
  }
}

// state root로 배치 데이터 조회 함수
async function getBatchDataByStateRoot(compressedData) {
  const batchFilePath = path.join(BATCH_DATA_DIR, `${compressedData}.json`);
  
  try {
    const data = JSON.parse(fs.readFileSync(batchFilePath, 'utf8'));
    console.log('\n[Sequencer] Found batch data for state root:', compressedData);
    console.log('Original Transactions:', data.originalData);
    console.log('Submission Time:', new Date(data.timestamp).toLocaleString());
  } catch (error) {
    console.log('\n[Sequencer] No batch data found for state root:', compressedData);
  }
}

// 사기 증명된 트랜잭션 처리 함수
async function handleFraudProof(fraudulentTxHash) {
  console.log('\n[Fraud Proof] Processing fraud proof for transaction:', fraudulentTxHash);
  
  const files = fs.readdirSync(BATCH_DATA_DIR);
  let fraudBatchFound = false;

  for (const file of files) {
    const batchFilePath = path.join(BATCH_DATA_DIR, file);
    const batchData = JSON.parse(fs.readFileSync(batchFilePath, 'utf8'));
    
    const fraudTxIndex = batchData.originalData.findIndex(tx => 
      tx.txhash.toLowerCase() === fraudulentTxHash.toLowerCase()
    );

    if (fraudTxIndex !== -1) {
      fraudBatchFound = true;
      console.log('[Fraud Proof] Found fraudulent transaction in batch:', file);
      
      // 사기 트랜잭션 이후의 모든 트랜잭션 제거
      batchData.originalData = batchData.originalData.slice(0, fraudTxIndex);
      
      if (batchData.originalData.length === 0) {
        fs.unlinkSync(batchFilePath);
        console.log('[Fraud Proof] Batch completely invalidated and removed');
      } else {
        const leaves = batchData.originalData.map(update => 
          ethers.utils.solidityKeccak256(
            ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
            [update.txhash, update.sender, update.recipient, update.amount, update.nonce, update.timestamp]
          )
        );

        const newBatchStateRoot = ethers.utils.solidityKeccak256(
          ['bytes32[]'],
          [leaves]
        );

        // 챌린지 트랜잭션 전송
        try {
          const batchIndex = batchData.batchIndex; // 배치 인덱스 저장 필요
          const tx = await rollupContract.challengeBatch(batchIndex, newBatchStateRoot);
          console.log(`[Fraud Proof] Challenging batch ${batchIndex} with new state root:`, newBatchStateRoot);
          console.log(`[Fraud Proof] Challenge transaction hash: ${tx.hash}`);
          
          const receipt = await tx.wait();
          console.log('[Fraud Proof] Challenge confirmed! Gas used:', receipt.gasUsed.toString());

          // 새 파일에 저장하고 이전 파일 삭제
          const newBatchFilePath = path.join(BATCH_DATA_DIR, `${newBatchStateRoot}.json`);
          fs.writeFileSync(newBatchFilePath, JSON.stringify({
            ...batchData,
            batchIndex,
            fraudProofApplied: true,
            originalStateRoot: file.replace('.json', ''),
            fraudulentTxHash: fraudulentTxHash,
            modificationTime: Date.now()
          }, null, 2));
          
          fs.unlinkSync(batchFilePath);
          console.log('[Fraud Proof] Batch data updated with new state root');
        } catch (error) {
          console.error('[Fraud Proof] Failed to submit challenge:', error);
        }
      }
      break;
    }
  }

  if (!fraudBatchFound) {
    console.log('[Fraud Proof] Transaction not found in any batch');
  }
}

// 배치 자동 finalize 체크 함수 추가
async function checkAndFinalizeBatches() {
  const files = fs.readdirSync(BATCH_DATA_DIR);
  
  for (const file of files) {
    const batchFilePath = path.join(BATCH_DATA_DIR, file);
    const batchData = JSON.parse(fs.readFileSync(batchFilePath, 'utf8'));
    
    if (!batchData.finalized && batchData.batchIndex !== undefined) {
      try {
        const status = await rollupContract.getBatchStatus(batchData.batchIndex);
        
        // status가 0(Unfinalized)이고 챌린지 기간이 지났다면
        if (status === 0 && 
            Date.now() >= batchData.timestamp + (7 * 24 * 60 * 60 * 1000)) {
          const tx = await rollupContract.finalizeBatch(batchData.batchIndex);
          console.log(`[Finalization] Finalizing batch ${batchData.batchIndex}`);
          
          const receipt = await tx.wait();
          console.log('[Finalization] Batch finalized! Gas used:', receipt.gasUsed.toString());
          
          // 배치 데이터 업데이트
          batchData.finalized = true;
          fs.writeFileSync(batchFilePath, JSON.stringify(batchData, null, 2));
        }
      } catch (error) {
        console.error(`[Finalization] Error processing batch ${batchData.batchIndex}:`, error);
      }
    }
  }
}

// 주기적으로 배치 finalize 체크 (예: 1시간마다)
setInterval(checkAndFinalizeBatches, 60 * 60 * 1000);

// CLI 명령어 처리 부분 수정
process.stdin.on('data', async (data) => {
  const input = data.toString().trim();
  if (input.startsWith('get ')) {
    const stateRoot = input.slice(4).trim();
    await getBatchDataByStateRoot(stateRoot);
  } else if (input.startsWith('fraud ')) {
    const txHash = input.slice(6).trim();
    await handleFraudProof(txHash);
  } else if (input === 'exit') {
    console.log('프로그램을 종료합니다...');
    process.exit();
  }
});

// 시작 메시지 수정
console.log('시퀀서가 시작되었습니다. 새로운 블록을 모니터링합니다...');
console.log('배치 데이터 조회: "get [state root]" 입력');
console.log('사기 증명 처리: "fraud [transaction hash]" 입력');
console.log('프로그램 종료: "exit" 입력');
