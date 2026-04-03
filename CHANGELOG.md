# Changelog

## v1.2.1 (2026-04-03)

### 버그 수정

#### MySQL 지원 안정화
- **스키마 트리 미표시 수정**: `information_schema` 쿼리 결과를 대문자 키(`COLUMN_NAME`, `TABLE_NAME` 등)로 반환하는 MySQL/MariaDB 환경에서 컬럼, 인덱스, 외래키가 표시되지 않던 문제 수정
- **Indexes / Views 섹션 MySQL 표시**: Indexes 및 Views 섹션 표시 조건이 PostgreSQL 전용으로 되어 있어 MySQL에서 미표시되던 문제 수정 (SQLite 제외 전체 DB로 확대)
- **`getLocks` 권한 오류 처리**: `performance_schema` 접근 권한이 없는 계정에서 모니터 잠금 탭 조회 시 에러 대신 빈 목록을 반환하도록 graceful 처리

#### 데이터 뷰어 UI 수정
- **고정 컬럼 틈 수정**: 체크박스(32px)·행번호(40px) 셀 너비를 `rem` 단위에서 `px` 단위로 명시하여 `sticky` 위치 계산 불일치로 인한 스크롤 틈 제거
- **고정 컬럼 배경 투명 수정**: `position: sticky` 셀에 반투명 상태 색상을 적용하면 스크롤 시 뒤 콘텐츠가 비치는 문제 수정 — 고정 셀 배경을 불투명 `background-color`로 고정하고 상태 색상은 `overlay div`로 분리

#### 테이블 편집
- **ColumnEditor 바인딩 수정**: `AlterTableDialog` / `CreateTableDialog`에서 `bind:col={col}` 대신 `bind:col={columns[idx]}`로 수정하여 컬럼 편집 시 반응성이 끊기던 문제 수정

#### 연결 등록 다이얼로그
- **스크롤 처리**: 콘텐츠가 길어질 때 다이얼로그가 화면 밖으로 벗어나는 문제 수정 (`max-h-[90vh]` + `overflow-y-auto`)
- **URL 미리보기 overflow**: 긴 연결 URL이 박스 밖으로 넘치지 않도록 `overflow-x-auto` 처리
