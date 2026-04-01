# db-player

데이터베이스 관리 데스크톱 애플리케이션. DBeaver와 유사한 DB 클라이언트 도구.

---

## 프로젝트 개요

- **목표**: DB 연결, 조회, 관리를 위한 GUI 클라이언트
- **기술**: Electron 기반 데스크톱 앱
- **타겟 플랫폼**: macOS, Windows
- **최종 목표**: 패키징하여 설치 가능한 앱으로 배포

---

## 논의 기록

### 2026-03-30 — 프로젝트 방향 설정
- DBeaver와 유사한 DB 관리 프로그램
- Electron 앱으로 개발, macOS/Windows 크로스 플랫폼 지원
- 패키징까지 완료하는 것이 목표
- 지원 DB: MySQL, PostgreSQL, SQLite (기본)
- DB 드라이버를 플러그인 방식으로 확장 가능하게 설계
- 프론트엔드: Svelte + Vite (성능 우선 선택)
- 프로젝트 생성은 사용자가 직접 수행, 가이드 제공 방식
- **1원칙: 성능** — 모든 기술 선택에서 성능 우선

### 기술 스택
| 영역 | 선택 | 이유 |
|------|------|------|
| 프레임워크 | Electron + Svelte + Vite | 런타임 오버헤드 최소 |
| DB 드라이버 | `mysql2`, `pg`, `better-sqlite3` | 각 DB별 1개씩 내장, 프로토콜 레벨 통신으로 DB/OS 버전별 관리 불필요 |
| 쿼리 에디터 | CodeMirror 6 | 가볍고 확장성 우수, Monaco 대비 번들 크기 작음 |
| UI 컴포넌트 | shadcn-svelte (bits-ui + Tailwind CSS) | 번들 최소, 필요한 것만 복사해서 사용 |

### 핵심 기능 (v1)
- **다중 세션 관리**: 여러 DB 연결을 동시에 열어 탭/패널로 전환
- **쿼리 에디터**: SQL 작성 및 실행
- **스키마 탐색기**: 트리 구조로 DB > 스키마 > 테이블 > 컬럼 탐색
- **결과 뷰어**: 쿼리 실행 결과를 테이블 형태로 표시

### 레이아웃
```
┌──────────┬───────────────────────┐
│          │     쿼리 에디터 (탭)    │
│  스키마   ├───────────────────────┤
│  트리     │     결과 뷰어          │
│  (좌측)   │     (하단)             │
└──────────┴───────────────────────┘
```
- 좌측 사이드바: 연결 목록 + 스키마 트리
- 우측 상단: 쿼리 에디터 (세션별 탭)
- 우측 하단: 결과 뷰어

### DB 드라이버 전략
- 기본 3종(MySQL, PostgreSQL, SQLite)은 앱에 내장 — 설치 즉시 사용 가능
- 추가 DB는 플러그인 방식으로 확장 가능하게 드라이버 인터페이스 통일
- Node.js 드라이버는 와이어 프로토콜 통신이라 DB 버전별 드라이버 불필요
- `better-sqlite3`의 네이티브 바이너리는 `electron-builder`가 OS별 자동 처리

### 앱 데이터 저장
- **저장소**: 내장 SQLite (`better-sqlite3`)
- **저장 위치**: OS별 앱 데이터 경로 (`app.getPath('userData')`)
- **저장 대상**: 연결 정보, 앱 설정, 쿼리 히스토리 등
- **비밀번호**: Electron `safeStorage` API로 암호화 후 SQLite에 저장

### DB 지원 전략

**PostgreSQL 우선 개발 원칙**: 모든 기능은 PostgreSQL 기준으로 먼저 구현하고, 이후 MySQL → SQLite 순으로 대응한다.

각 DB별 주요 차이점:

| 항목 | PostgreSQL | MySQL | SQLite |
|------|-----------|-------|--------|
| 스키마 | 독립적인 네임스페이스 | 데이터베이스 = 스키마 | 없음 (파일 하나가 전체) |
| Materialized View | 지원 (`REFRESH MATERIALIZED VIEW`) | 미지원 | 미지원 |
| Functions | 다양한 언어(PL/pgSQL 등) | SQL/스토어드 프로시저 | 제한적 |
| DDL 문법 | PostgreSQL 방언 | MySQL 방언 | SQLite 방언 |
| 시스템 스키마 | `pg_catalog`, `information_schema` 등 필터링 필요 | `information_schema` | 없음 |

**컨텍스트 메뉴 분기 원칙**:
- `dbType` 값: `'postgresql'` | `'mysql'` | `'sqlite'`
- `SidebarActionContext`와 컨텍스트 메뉴 컴포넌트 모두 `dbType`을 전달받아, 지원하지 않는 항목은 메뉴에서 숨김 처리
- 액션 구현 시 `dbType` 기반으로 분기하거나 DB별 어댑터 함수로 위임
- **특정 DB 전용 기능은 구현 전 사용자에게 반드시 알린다**

### 향후 추가 기능
- 데이터 벌크 입출력 (import/export)
