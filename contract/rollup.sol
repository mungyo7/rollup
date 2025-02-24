// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleRollup {
    // 배치 상태를 추적하기 위한 열거형
    enum BatchStatus { Unfinalized, Finalized }

    // 배치 구조체 정의
    struct Batch {
        bytes32 compressedData;
        uint256 timestamp;
        BatchStatus status;
    }

    // 이벤트 정의
    event BatchSubmitted(uint256 batchIndex, bytes32 compressedData);
    event BatchChallenged(uint256 batchIndex, bytes32 newCompressedData);
    event BatchFinalized(uint256 batchIndex);

    // 배치 저장 매핑으로 변경
    mapping(uint256 => Batch) public batches;
    uint256 public batchCount;

    // 챌린지 기간 (7일)
    uint256 public constant CHALLENGE_PERIOD = 7 days;

    // 새로운 배치를 제출하는 함수
    function submitBatch(bytes32 _compressedData) external {
        batches[batchCount] = Batch({
            compressedData: _compressedData,
            timestamp: block.timestamp,
            status: BatchStatus.Unfinalized
        });
        
        emit BatchSubmitted(batchCount, _compressedData);
        batchCount++;
    }

    // 배치에 대한 챌린지 함수
    function challengeBatch(uint256 _batchIndex, bytes32 _newCompressedData) external {
        require(_batchIndex < batchCount, "Index out of range");
        require(batches[_batchIndex].status == BatchStatus.Unfinalized, "Batch already finalized");
        
        batches[_batchIndex].compressedData = _newCompressedData;
        batches[_batchIndex].timestamp = block.timestamp;
        
        emit BatchChallenged(_batchIndex, _newCompressedData);
    }

    // 배치 최종 확정 함수
    function finalizeBatch(uint256 _batchIndex) external {
        require(_batchIndex < batchCount, "Index out of range");
        require(batches[_batchIndex].status == BatchStatus.Unfinalized, "Batch already finalized");
        require(
            block.timestamp >= batches[_batchIndex].timestamp + CHALLENGE_PERIOD,
            "Challenge period not ended"
        );
        
        batches[_batchIndex].status = BatchStatus.Finalized;
        emit BatchFinalized(_batchIndex);
    }

    // 배치 상태 확인 함수
    function getBatchStatus(uint256 _batchIndex) external view returns (BatchStatus) {
        require(_batchIndex < batchCount, "Index out of range");
        return batches[_batchIndex].status;
    }

    // 전체 배치 수 확인
    function getBatchesCount() external view returns (uint256) {
        return batchCount;
    }

    // 특정 배치 조회
    function getBatchByIndex(uint256 _index) external view returns (bytes32) {
        require(_index < batchCount, "Index out of range");
        return batches[_index].compressedData;
    }
}
