# db-player

DBeaver와 유사한 DB 관리 데스크톱 애플리케이션. **1원칙: 성능**.

---

## 프로젝트 개요

- **목표**: DB 연결·조회·관리를 위한 GUI 클라이언트
- **기술**: Electron + Svelte 5 + TypeScript + Vite (`electron-vite`)
- **타겟 플랫폼**: macOS, Windows
- **최종 목표**: 패키징하여 설치 가능한 앱으로 배포

---

## 기술 스택

| 영역 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | Electron + Svelte 5 + Vite | 런타임 오버헤드 최소 |
| DB 드라이버 | `mysql2`, `pg`, `better-sqlite3` | 각 DB별 1개씩 내장, 프로토콜 레벨 통신 |
| 쿼리 에디터 | CodeMirror 6 | 가볍고 확장성 우수, Monaco 대비 번들 크기 작음 |
| UI 컴포넌트 | shadcn-svelte (bits-ui + Tailwind CSS v4) | 번들 최소, 필요한 것만 복사 |
| 아이콘 | lucide-svelte | |
| 패키징 | electron-builder | |

---

## 구현된 기능

### 연결 관리
- 연결 저장/수정/삭제 (비밀번호는 `safeStorage` API로 암호화, SQLite에 저장)
- 연결 테스트
- 연결 목록 사이드바 표시, 우클릭 컨텍스트 메뉴 (편집/삭제/SQL 에디터 열기)

### 스키마 탐색기 (좌측 사이드바)
- PostgreSQL: 스키마 목록 조회 (`pg_catalog`, `information_schema`, `pg_toast` 계열 필터링)
- 스키마 확장 시 Tables / Views / Materialized Views / Functions 트리 표시
- 테이블 확장 시 컬럼 정보 (이름·타입·nullable·PK 여부), Indexes, Sequences, Foreign Keys 표시
- PK 컬럼은 KeyRound 아이콘 + amber 색상으로 구분
- 테이블 다중 선택 (단순 클릭·Cmd+클릭 토글·Shift+클릭 범위)
- 우클릭 컨텍스트 메뉴 (데이터 조회·SQL 에디터 열기·DDL 보기·DDL 복사·수정·새로고침·삭제)
- DDL 복사 다중 선택 지원: FK 의존성 기반 토폴로지 정렬 후 복사

### 스키마 관리 (PostgreSQL 전용)
- 스키마 생성 (이름·소유자 지정, `pg_roles` 드롭다운)
- 스키마 편집 (이름 변경·소유자 변경)
- 스키마 삭제 (CASCADE 옵션)

### 테이블 DDL 관리 (PostgreSQL 전용)
- **테이블 생성**: 컬럼 타입/크기/NULL/기본값/PK, 복합 PK, FK (ON DELETE·ON UPDATE)
- **테이블 수정**: 기존 컬럼·FK 초기값 로드 → diff 추적 → `ALTER TABLE` 실행 (트랜잭션 내)
  - 컬럼 추가/삭제/이름변경/타입변경/NULL/DEFAULT 변경
  - PK 재구성, FK 추가/삭제/수정, 테이블 이름 변경
- **DDL 팝업**: 테이블·뷰·Materialized View·함수의 DDL 읽기 전용 조회 + 클립보드 복사

### SQL 에디터
- **CodeMirror 6** 기반: 라인 번호, 구문 하이라이팅, 실행 이력 (Undo/Redo)
- **자동완성**: 스키마·테이블·컬럼 계층 자동완성 (PostgreSQL/MySQL/SQLite 전체 지원)
- **에러 위치 표시**: 실행 오류 발생 시 해당 위치에 빨간 물결 표시 (linter)
- **SQL 포맷**: `sql-formatter` 기반, dbType별 dialect 적용
- **라이트/다크 테마** 동기화 (Compartment 기반 하이라이트 스타일 동적 교체)
- 선택 영역만 실행 지원
- `Cmd/Ctrl+Enter` 실행 단축키

### 쿼리 실행
- **단일/다중 쿼리 분리 실행**: `;` 기준 파싱 (문자열·주석 내 세미콜론 무시)
- **배치 실행**: DB 연결 1개로 처리, "오류 시 중단" 옵션
- **트랜잭션 제어**: 다중 쿼리 실행 시 `BEGIN/COMMIT/ROLLBACK` (PostgreSQL·MySQL·SQLite 각각 지원), 커밋/롤백 결과 뱃지 표시
- **쿼리 취소**: PostgreSQL은 `pg_cancel_backend`, MySQL은 `KILL QUERY` (실행 중 취소 버튼으로 전환)
- **LIMIT 누락 경고**: SELECT 쿼리에 LIMIT 없으면 amber 경고 배너 표시

### 결과 뷰어 (QueryResultViewer)
- 클라이언트 사이드 정렬·필터·페이지네이션
- 다중 정렬 (우선순위 숫자 표시)
- 컬럼 고정 (헤더 우클릭 컨텍스트 메뉴)
- 컬럼 리사이즈
- **타입별 셀 색상**: numeric(파란색)·datetime(보라색)·boolean(초록/빨강)
- JSON 모달 팝업
- 행 선택·CSV 복사·Export
- 다중 쿼리 탭 (쿼리별 상태 인디케이터)

### 데이터 뷰어 (DataViewerTab)
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

### EXPLAIN 시각화
- SELECT 단일 쿼리일 때 EXPLAIN 버튼 활성화
- PostgreSQL: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
- MySQL: `EXPLAIN FORMAT=JSON`
- SQLite: `EXPLAIN QUERY PLAN`
- **트리 구조 시각화**: 재귀 노드, 전체 maxTime 대비 비율로 red/amber 히트맵
- actualTime×loops 계산, Index Name·Filter·Hash Condition 등 extra 필드 표시
- 상단 총 실행 시간 + 색상 범례

### ER 다이어그램 (PostgreSQL 전용)
- `@dagrejs/dagre` 기반 자동 레이아웃 + SVG 직접 렌더링
- 테이블 카드 (헤더+컬럼 목록, PK 표시), FK 관계선 (화살표)
- 마우스 휠 줌 / 드래그 패닝
- 툴바: 확대/축소/초기화 버튼
- 스키마 컨텍스트 메뉴에서 탭으로 열기

### 쿼리 히스토리
- 쿼리 실행 시 자동 저장 (최대 100건, SQLite 로컬 저장)
- 툴바 히스토리 버튼 → 드롭다운 패널 (성공/실패 표시, 상대 시간, SQL 미리보기)
- 클릭 시 에디터에 로드

### UX
- **멀티탭 워크스페이스**: 쿼리 에디터·데이터 뷰어·ERD를 탭으로 관리
- **에디터 좌우 분할**: 탭 바 우측 분할 버튼, 독립 쿼리/결과 상태
- **Command Palette** (`Cmd+K`): 새 탭·쿼리 실행·포맷·히스토리·테마·연결 전환 fuzzy 검색
- **라이트/다크 테마** 전환
- **네이티브 메뉴바**: 파일(새 쿼리 탭 `Cmd+T`·탭 닫기 `Cmd+W`), 보기, 윈도우 메뉴
- New Query 버튼 (헤더)

---

## DB 지원 현황

**PostgreSQL 우선 개발**. 모든 기능은 PostgreSQL 기준으로 먼저 구현하고, 이후 MySQL → SQLite 순으로 대응한다.

| 기능 | PostgreSQL | MySQL | SQLite |
|------|:---:|:---:|:---:|
| 연결·테스트 | ✅ | ✅ | ✅ |
| 스키마 탐색 | ✅ | ✅ | ✅ |
| SQL 실행 (단일/배치) | ✅ | ✅ | ✅ |
| 자동완성 | ✅ | ✅ | ✅ |
| 데이터 조회·편집 | ✅ | ✅ | ✅ |
| 쿼리 취소 | ✅ | ✅ | ❌ |
| 트랜잭션 제어 | ✅ | ✅ | ✅ |
| EXPLAIN | ✅ | ✅ | ✅ (QUERY PLAN) |
| 스키마 생성/편집/삭제 | ✅ | ❌ | ❌ |
| 테이블 생성/수정 | ✅ | ❌ | ❌ |
| DDL 팝업 | ✅ | ❌ | ❌ |
| Materialized View | ✅ | ❌ | ❌ |
| ER 다이어그램 | ✅ | ❌ | ❌ |

---

## 아키텍처

`electron-vite` 기반 3-레이어 구조.

```
src/
├── main/          # Electron 메인 프로세스 (Node.js API, DB 드라이버, IPC 핸들러)
│   └── db/        # DB 드라이버 추상화 (metadata.ts, ddl-builder.ts, app-db.ts, ...)
├── preload/       # contextBridge 노출 API (index.ts, index.d.ts)
└── renderer/      # Svelte 프론트엔드
    └── src/
        ├── components/   # 기능별 UI 컴포넌트
        └── lib/
            ├── stores/   # 상태 관리 (tabs, connections, theme, commands, ...)
            ├── actions/  # 사이드바 액션 핸들러
            └── components/ui/  # shadcn-svelte UI 컴포넌트
```

메인-렌더러 통신은 IPC, preload에서 `contextBridge.exposeInMainWorld`로 API 노출.

---

## 앱 데이터 저장

- **저장소**: 내장 SQLite (`better-sqlite3`)
- **저장 위치**: OS별 앱 데이터 경로 (`app.getPath('userData')`)
- **저장 대상**: 연결 정보, 쿼리 히스토리
- **비밀번호**: Electron `safeStorage` API로 암호화 후 SQLite에 저장

---

## 향후 추가 기능

- 데이터 벌크 입출력 (import/export)
- MySQL 테이블 생성/수정
- SQLite 스키마 탐색 개선
