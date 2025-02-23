// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleRollup {
    // 배치가 제출될 때마다 기록할 이벤트
    event BatchSubmitted(uint256 batchIndex, bytes32 compressedData);

    // 여러 배치들의 해시를 저장하는 간단한 배열
    bytes32[] public batches;

    // 새로운 배치를 제출하는 함수
    // 실제로는 트랜잭션 리스트 전체를 저장하기보다는
    // 그 해시(압축된 형태)만 저장하는 방식이 일반적
    function submitBatch(bytes32 _compressedData) external {
        batches.push(_compressedData);
        emit BatchSubmitted(batches.length - 1, _compressedData);
    }

    // 전체 배치 수 확인
    function getBatchesCount() external view returns (uint256) {
        return batches.length;
    }

    // 특정 배치 조회
    function getBatchByIndex(uint256 _index) external view returns (bytes32) {
        require(_index < batches.length, "Index out of range");
        return batches[_index];
    }
}
