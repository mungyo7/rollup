# RollUp 🔄
## Sepolia Network Rollup Implementation

### 주요 기능
- Sepolia 네트워크에서 작동
- 설정한 A, B 지갑에서 트랜잭션 발생시 감지
- 트랜잭션 정보를 sequencer에 추가
- Sequencer에 3개의 트랜잭션이 쌓이면 배치 생성
- 롤업 컨트랙트로 해시화해서 전송

### 추가할 것
- 배치 state root 방식(실제 옵티미즘 롤업 방식)
- 챌린지 기능
- 롤업 컨트랙트에서 배치 데이터 받아와서 역해시화해서 확인
