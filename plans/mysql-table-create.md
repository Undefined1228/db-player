# MySQL 테이블 생성 지원

## Context
`CreateTableDialog`와 `ddl-builder.ts`는 현재 PostgreSQL 기준으로 구현됨.
MySQL 연결에서 테이블 생성 시 DDL 빌더 및 타입 목록 분기 추가 필요.

---

## DDL 차이점

| 항목 | PostgreSQL | MySQL |
|------|-----------|-------|
| 자동증가 | `serial`, `bigserial` | `INT AUTO_INCREMENT`, `BIGINT AUTO_INCREMENT` |
| boolean | `boolean` | `TINYINT(1)` |
| uuid | `uuid` | `CHAR(36)` 또는 `VARCHAR(36)` |
| jsonb | `jsonb` | 미지원 → `json` 사용 |
| timestamptz | `timestamptz` | 미지원 → `DATETIME` 또는 `TIMESTAMP` |
| interval | `interval` | 미지원 |
| bytea | `bytea` | `BLOB` |
| double precision | `double precision` | `DOUBLE` |
| 식별자 인용 | `"ident"` | `` `ident` `` |
| 스키마 참조 | `"schema"."table"` | `` `database`.`table` `` |
| FK 문법 | 동일 | 동일하나 MyISAM 엔진은 FK 미지원 (InnoDB만) |

## 작업 내용

### ddl-builder.ts
- `buildMysqlDDL(params: CreateTableParams): string` 함수 추가
- `serial` → `INT AUTO_INCREMENT`
- `bigserial` → `BIGINT AUTO_INCREMENT`
- `boolean` → `TINYINT(1)`
- `uuid` → `CHAR(36)`
- `jsonb` → `json`
- `timestamptz` → `DATETIME`
- `bytea` → `BLOB`
- `double precision` → `DOUBLE`
- `interval` → 미지원 에러 또는 제거
- 식별자 백틱 인용

### metadata.ts
- `createTable`에서 `dbType === 'mysql'`일 때 `buildMysqlDDL` 분기 추가

### CreateTableDialog.svelte
- `dbType === 'mysql'`일 때 `TYPE_GROUPS_MYSQL` 별도 타입 목록 사용
- 미지원 타입(`interval`, `timestamptz`, `jsonb`, `bytea`, `uuid`) MySQL 탭에서 제거 또는 대체 안내

## 검증
- MySQL 연결에서 테이블 생성 다이얼로그 열었을 때 MySQL 타입 목록 표시 확인
- AUTO_INCREMENT 컬럼 생성 확인
- FK 생성 확인 (InnoDB 엔진 필수)
