# RollUp 🔄

Sepolia Network Rollup System and Sequencer

## 개요
이 프로젝트는 이더리움의 Sepolia 테스트넷에서 동작하는 롤업 시스템을 구현합니다. 트랜잭션의 배치 처리와 챌린지 기반의 검증 시스템을 포함합니다.

## 주요 기능

### 트랜잭션 처리
- 지정된 A, B 지갑의 트랜잭션 모니터링 및 발생 감지
- Sequencer를 통한 트랜잭션 수집 및 관리
- 3개의 트랜잭션 단위로 Batch 생성

### 롤업 메커니즘
- Batch Data 해시화 및 롤업 컨트랙트 전송
- 각 Batch는 다음 정보를 포함:
  - Transaction Data
  - Timestamp
  - Batch Index
  - State Root
- Batch Data는 sequencer 로컬에 파일로 저장되어 추후 조회 및 수정 가능

### 검증 시스템
- 새로운 Batch는 초기에 'Unfinalized' 상태로 등록
- 챌린지 기간을 통한 유효성 검증
- 챌린지 기간 이후 'Finalized' 상태로 전환

### 챌린지 메커니즘
- 챌린지 기간 내 사기 증명 트랜잭션 검증
- 부정 트랜잭션 발견 시:
  - Unfinalized 상태의 Batch 중 해당 트랜잭션을 찾아 Batch 내 해당 트랜잭션 이후의 모든 트랜잭션 제거
  - 새로운 State Root 계산
  - 수정된 Batch로 교체


