# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

DBeaver와 유사한 DB 관리 데스크톱 애플리케이션. Electron + Svelte 5 + TypeScript + Vite 기반.
타겟 플랫폼은 macOS, Windows. **1원칙: 성능**.

## 개발 명령어

```bash
npm run dev              # 개발 모드 (Electron + HMR)
npm run build            # 타입체크 + 빌드
npm run build:mac        # macOS 패키징
npm run build:win        # Windows 패키징
npm run lint             # ESLint (캐시 사용)
npm run format           # Prettier 포맷팅
npm run typecheck        # TypeScript + svelte-check
npm run typecheck:node   # 메인/preload 타입체크만
npm run svelte-check     # Svelte 컴포넌트 타입체크만
```

## 아키텍처

`electron-vite` 기반 3-레이어 구조. 각 레이어는 독립된 빌드 설정을 가짐.

- **`src/main/`** — Electron 메인 프로세스. Node.js API, DB 드라이버, IPC 핸들러. 빌드 결과는 `out/main/`
- **`src/preload/`** — contextBridge를 통해 메인↔렌더러 간 API 노출. `index.d.ts`에 타입 정의
- **`src/renderer/`** — Svelte 프론트엔드. Vite로 빌드. 빌드 결과는 `out/renderer/`

메인-렌더러 통신은 IPC를 사용하며, preload에서 `contextBridge.exposeInMainWorld`로 API를 노출하는 패턴.

## 기술 스택

| 영역 | 선택 |
|------|------|
| 프레임워크 | Electron + Svelte 5 + Vite (`electron-vite`) |
| 언어 | TypeScript (strict) |
| DB 드라이버 | `mysql2`, `pg`, `better-sqlite3` (예정, 각 1개씩 내장) |
| 쿼리 에디터 | CodeMirror 6 (예정) |
| UI 컴포넌트 | shadcn-svelte + bits-ui + Tailwind CSS v4 |
| 아이콘 | lucide-svelte |
| 패키징 | electron-builder |

## 설계 원칙

- DB 드라이버는 통일된 인터페이스로 추상화하여 플러그인 방식 확장 가능하게 설계
- 기본 지원 DB: MySQL, PostgreSQL, SQLite
- Node.js 드라이버는 와이어 프로토콜 통신이므로 DB 버전별 드라이버 관리 불필요

## DB별 기능 게이팅 원칙

**PostgreSQL 우선 개발**. 모든 기능은 PostgreSQL 기준으로 먼저 구현하고, 이후 MySQL → SQLite 순으로 대응한다.

**특정 DB 전용 기능은 구현 전 사용자에게 반드시 알린다.** UI(메뉴, 버튼 등)에서는 `dbType` 조건으로 해당 DB가 아닐 때 항목을 숨긴다.

PostgreSQL 전용 기능 목록:
- Materialized View (조회, DDL 보기, `REFRESH MATERIALIZED VIEW`)
- 스키마 추가 / 스키마 단위 관리
- PL/pgSQL 함수

`dbType` 값: `'postgresql'` | `'mysql'` | `'sqlite'`

## 컴포넌트 구조 규칙

- 기능 단위로 컴포넌트를 분리하여 관리
- shadcn-svelte UI 컴포넌트: `src/renderer/src/lib/components/ui/` (CLI로 추가)
- 앱 컴포넌트: `src/renderer/src/components/` (기능별 분리)
- 상태 관리(store): `src/renderer/src/lib/stores/`
- shadcn 컴포넌트 추가: `npx shadcn-svelte@next add <컴포넌트> --yes`

## TypeScript 설정

- `tsconfig.node.json` — 메인/preload 프로세스용
- `tsconfig.web.json` — 렌더러(Svelte) 프로세스용
- 루트 `tsconfig.json`은 두 설정을 references로 묶는 역할만 수행

## 패키징 설정

`electron-builder.yml`에 정의. appId: `com.electron.app`, productName: `db-player`.
