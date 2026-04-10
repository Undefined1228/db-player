# 구현된 기능

## 연결 관리
- 연결 저장/수정/삭제 (비밀번호는 `safeStorage` API로 암호화, SQLite에 저장)
- 연결 테스트
- 연결 목록 사이드바 표시, 우클릭 컨텍스트 메뉴 (편집/삭제/SQL 에디터 열기)
- **SSH 터널** 지원: 비밀번호 / 개인키 인증 방식 선택 가능

## 스키마 탐색기 (좌측 사이드바)
- PostgreSQL: 스키마 목록 조회 (`pg_catalog`, `information_schema`, `pg_toast` 계열 필터링)
- MySQL / MariaDB: 데이터베이스 목록 조회
- 스키마 확장 시 Tables / Views / Materialized Views / Functions 트리 표시
- 테이블 확장 시 컬럼 정보 (이름·타입·nullable·PK 여부), Indexes, Sequences, Foreign Keys 표시
- PK 컬럼은 KeyRound 아이콘 + amber 색상으로 구분
- 테이블 다중 선택 (단순 클릭·Cmd+클릭 토글·Shift+클릭 범위)
- 우클릭 컨텍스트 메뉴 (데이터 조회·SQL 에디터 열기·DDL 보기·DDL 복사·수정·새로고침·삭제)
- DDL 복사 다중 선택 지원: FK 의존성 기반 토폴로지 정렬 후 복사

## 스키마 관리 (PostgreSQL 전용)
- 스키마 생성 (이름·소유자 지정, `pg_roles` 드롭다운)
- 스키마 편집 (이름 변경·소유자 변경)
- 스키마 삭제 (CASCADE 옵션)

## 테이블 DDL 관리
- **테이블 생성**: 컬럼 타입/크기/NULL/기본값/PK, 복합 PK, FK (ON DELETE·ON UPDATE) — PostgreSQL / MySQL
- **테이블 수정**: 기존 컬럼·FK 초기값 로드 → diff 추적 → `ALTER TABLE` 실행 (트랜잭션 내) — PostgreSQL / MySQL
  - 컬럼 추가/삭제/이름변경/타입변경/NULL/DEFAULT 변경
  - PK 재구성, FK 추가/삭제/수정, 테이블 이름 변경
- **DDL 팝업**: 테이블·뷰·Materialized View·함수의 DDL 읽기 전용 조회 + 클립보드 복사 — PostgreSQL / MySQL

## 뷰(View) 관리 (PostgreSQL, MySQL)
- 뷰 생성: 이름 + SELECT 쿼리 입력 → `CREATE OR REPLACE VIEW`
- 뷰 수정: 기존 SELECT 쿼리 자동 로드, 이름 변경 및 쿼리 변경 지원
- 뷰 삭제: 확인 다이얼로그 후 `DROP VIEW`
- 뷰 생성/수정 에디터: SQL 자동완성 + 구문 하이라이팅 + 테마 연동

## 인덱스 관리 (PostgreSQL, MySQL)
- 인덱스 생성: 이름, UNIQUE 여부, 인덱스 방식(B-tree / Hash / GIN / GiST / BRIN), 컬럼 및 정렬 방향(ASC/DESC)
- 인덱스 삭제
- 인덱스 항목에 UNIQUE 배지 및 컬럼 목록 표시

## SQL 에디터
- **CodeMirror 6** 기반: 라인 번호, 구문 하이라이팅, 실행 이력 (Undo/Redo)
- **자동완성**: 스키마·테이블·컬럼 계층 자동완성 (PostgreSQL/MySQL/SQLite 전체 지원)
- **에러 위치 표시**: 실행 오류 발생 시 해당 위치에 빨간 물결 표시 (linter)
- **SQL 포맷**: `sql-formatter` 기반, dbType별 dialect 적용
- **라이트/다크 테마** 동기화 (Compartment 기반 하이라이트 스타일 동적 교체)
- 선택 영역만 실행 지원
- `Cmd/Ctrl+Enter` 실행 단축키

## 쿼리 실행
- **단일/다중 쿼리 분리 실행**: `;` 기준 파싱 (문자열·주석 내 세미콜론 무시)
- **배치 실행**: DB 연결 1개로 처리, "오류 시 중단" 옵션
- **트랜잭션 제어**: 다중 쿼리 실행 시 `BEGIN/COMMIT/ROLLBACK` (PostgreSQL·MySQL·SQLite 각각 지원), 커밋/롤백 결과 뱃지 표시
- **쿼리 취소**: PostgreSQL은 `pg_cancel_backend`, MySQL/MariaDB는 `KILL QUERY` (실행 중 취소 버튼으로 전환)
- **LIMIT 누락 경고**: SELECT 쿼리에 LIMIT 없으면 amber 경고 배너 표시

## 결과 뷰어 (QueryResultViewer)
- 클라이언트 사이드 정렬·필터·페이지네이션
- 다중 정렬 (우선순위 숫자 표시)
- 컬럼 고정 (헤더 우클릭 컨텍스트 메뉴)
- 컬럼 리사이즈
- **타입별 셀 색상**: numeric(파란색)·datetime(보라색)·boolean(초록/빨강)
- JSON 모달 팝업
- 행 선택·CSV 복사·Export
- 다중 쿼리 탭 (쿼리별 상태 인디케이터)

## 데이터 뷰어 (DataViewerTab)
- 테이블·뷰·Materialized View 데이터 조회 (pagination 100건 단위)
- **인라인 편집**: 셀 클릭 편집, Tab/Shift+Tab/Enter 키보드 네비게이션
- **NULL 명시 설정**: `Ctrl+Delete`로 null 저장
- **boolean 렌더링**: bool 타입 컬럼은 체크박스로 표시/편집
- **timestamp 포맷**: ko-KR locale 포맷 표시
- 행 추가 (기본값 자동 채움, 시퀀스 제외), 행 삭제, 행 복제
- 체크박스 컬럼 + 행 번호 sticky 고정
- 컬럼 고정 (헤더 우클릭 → 정렬 오름/내림/해제, 고정 체크박스), 다중 고정 지원
- 검색 (클라이언트 사이드, 하이라이트 표시)
- **타입별 셀 색상** 적용

## EXPLAIN 시각화
- SELECT 단일 쿼리일 때 EXPLAIN 버튼 활성화
- PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
- MySQL / MariaDB: `EXPLAIN FORMAT=JSON` (MariaDB 전용 파서 별도 적용)
- SQLite: `EXPLAIN QUERY PLAN`
- **트리 구조 시각화**: 재귀 노드, 전체 maxTime 대비 비율로 red/amber 히트맵
- actualTime×loops 계산, Index Name·Filter·Hash Condition 등 extra 필드 표시
- 상단 총 실행 시간 + 색상 범례

## 세션 모니터 (PostgreSQL, MySQL, MariaDB)
- 사이드바 연결 우클릭 → **세션 모니터**로 진입
- **활성 세션**: 현재 DB에 연결된 세션 목록, 상태 뱃지(active/idle 등), 실행 시간, 실행 쿼리 표시
- **세션 강제 종료**: 쿼리 취소(`active` 상태만) / 연결 종료 — 확인 다이얼로그 필수
- **잠금 현황**: Lock Wait 상태인 세션과 차단 세션을 쌍으로 표시, 잠금 유형 및 대상 테이블 표시
- **테이블 통계**: 전체/테이블/인덱스 크기, 추정 행 수 (PostgreSQL 전용: Dead Tuples, 마지막 VACUUM 시각)
- **자동 새로고침**: 5초 / 10초 / 30초 / 60초 주기 설정

## ER 다이어그램 (PostgreSQL 전용)
- `@dagrejs/dagre` 기반 자동 레이아웃 + SVG 직접 렌더링
- 테이블 카드 (헤더+컬럼 목록, PK 표시), FK 관계선 (화살표)
- 마우스 휠 줌 / 드래그 패닝
- 툴바: 확대/축소/초기화 버튼
- 스키마 컨텍스트 메뉴에서 탭으로 열기

## 쿼리 히스토리
- 쿼리 실행 시 자동 저장 (최대 100건, SQLite 로컬 저장)
- 툴바 히스토리 버튼 → 드롭다운 패널 (성공/실패 표시, 상대 시간, SQL 미리보기)
- 클릭 시 에디터에 로드

## 자동 업데이트
- 앱 시작 시 최신 버전 확인 (`checkUpdate`)
- 업데이트 발견 시 알림 배너 표시
- 백그라운드 다운로드 완료 후 재시작 시 자동 설치

## UX
- **멀티탭 워크스페이스**: 쿼리 에디터·데이터 뷰어·ERD를 탭으로 관리
- **에디터 좌우 분할**: 탭 바 우측 분할 버튼, 독립 쿼리/결과 상태
- **Command Palette** (`Cmd+K`): 새 탭·쿼리 실행·포맷·히스토리·테마·연결 전환 fuzzy 검색
- **라이트/다크 테마** 전환
- **네이티브 메뉴바**: 파일(새 쿼리 탭 `Cmd+T`·탭 닫기 `Cmd+W`), 보기, 윈도우 메뉴
- New Query 버튼 (헤더)

---

## 향후 추가 기능

- 데이터 벌크 입출력 (import/export)
- SQLite 스키마 탐색·테이블 편집
- MariaDB EXPLAIN 전용 파서 완성
- MySQL / MariaDB ER 다이어그램
