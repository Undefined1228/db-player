# 향후 개발 리마인드

## SQLite 원격 접속 지원
- SQLite도 IP/Port 기반 외부 접속 방식을 지원할 수 있도록 한다
- 현재는 로컬 파일 경로(`filePath`) 방식만 구현되어 있음
- `ConnectionDialog`, `test-connection.ts`, `metadata.ts` 등에서 SQLite의 host/port 입력 및 연결 로직 추가 필요
