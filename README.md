# db-player

DBeaver와 유사한 DB 관리 데스크톱 애플리케이션. **1원칙: 성능**.

---

## 프로젝트 개요

- **목표**: DB 연결·조회·관리를 위한 GUI 클라이언트
- **기술**: Electron + Svelte 5 + TypeScript + Vite (`electron-vite`)
- **타겟 플랫폼**: macOS, Windows
- **최종 목표**: 패키징하여 설치 가능한 앱으로 배포

구현된 기능 목록은 [FEATURES.md](FEATURES.md)를 참고.

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

## DB 지원 현황

**PostgreSQL 우선 개발**. 모든 기능은 PostgreSQL 기준으로 먼저 구현하고, 이후 MySQL → SQLite 순으로 대응한다.

| 기능 | PostgreSQL | MySQL / MariaDB | SQLite |
|------|:---:|:---:|:---:|
| 연결·테스트 | ✅ | ✅ | ✅ |
| SSH 터널 | ✅ | ✅ | ✅ |
| 스키마 탐색 | ✅ | ✅ | ✅ |
| SQL 실행 (단일/배치) | ✅ | ✅ | ✅ |
| 자동완성 | ✅ | ✅ | ✅ |
| 데이터 조회·편집 | ✅ | ✅ | ✅ |
| 쿼리 취소 | ✅ | ✅ | ❌ |
| 트랜잭션 제어 | ✅ | ✅ | ✅ |
| EXPLAIN | ✅ | ✅ | ✅ (QUERY PLAN) |
| 테이블 생성/수정 | ✅ | ✅ | ❌ |
| DDL 팝업 | ✅ | ✅ | ❌ |
| 뷰 생성/수정/삭제 | ✅ | ✅ | ❌ |
| 인덱스 생성/삭제 | ✅ | ✅ | ❌ |
| 세션 모니터 | ✅ | ✅ | ❌ |
| 스키마 생성/편집/삭제 | ✅ | ❌ | ❌ |
| Materialized View | ✅ | ❌ | ❌ |
| ER 다이어그램 | ✅ | ❌ | ❌ |

---

## 아키텍처

`electron-vite` 기반 3-레이어 구조.

```
src/
├── main/          # Electron 메인 프로세스 (Node.js API, DB 드라이버, IPC 핸들러)
│   ├── db/        # DB 드라이버 추상화 (metadata.ts, ddl-builder.ts, app-db.ts, ...)
│   └── ipc/       # IPC 핸들러 도메인별 분리 (connection, data, query, schema, table, monitor)
├── preload/       # contextBridge 노출 API (index.ts, index.d.ts)
└── renderer/      # Svelte 프론트엔드
    └── src/
        ├── components/   # 기능별 UI 컴포넌트
        └── lib/
            ├── stores/   # 상태 관리 (tabs, connections, theme, commands, ddl-dialog)
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

## 빌드 및 배포

| 플랫폼 | 명령어 |
|--------|--------|
| macOS | `npm run build:mac` |
| Windows | `npm run build:win` |

빌드 결과물은 `dist/` 디렉토리에 생성된다.
