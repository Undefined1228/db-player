# UX / 생산성 개선

구현 순서대로 정렬. 완료 시 `[ ]` → `[x]`.

---

## 1. [x] 탭 이름 편집

쿼리 탭에 의미 있는 이름을 직접 지정.

- 탭 이름 더블클릭 → 인라인 input으로 전환
- Enter 또는 포커스 해제 시 저장, Escape 시 취소
- 기본 이름: "쿼리 1", "쿼리 2" 등 (현재와 동일)
- 이름은 탭 store(`src/lib/stores/tabs.ts`)에 저장
- 탭 이름 최대 길이 제한 (30자)

---

## 2. [ ] 에디터 그룹 분할 (탭 드래그)

탭을 드래그해서 화면을 좌우로 분리하는 VS Code 방식의 에디터 그룹.

- 탭을 드래그해서 오른쪽 절반 드롭 존에 놓으면 에디터 그룹 분리
- 각 그룹은 독립된 탭 바 + 에디터 영역을 가짐
- 그룹 간 탭 이동 가능 (드래그로 다른 그룹으로 옮기거나 합치기)
- 그룹 닫힐 때(탭 모두 닫힘) 나머지 그룹이 전체 영역 차지
- 그룹 사이 리사이즈 핸들로 비율 조정
- `tabsStore`를 그룹 개념으로 재설계 필요:
  - `TabGroup { id, tabs[], activeId }` 단위로 관리
  - 최상위 상태: `groups: TabGroup[]`, `activeGroupId`

---

## 3. [x] macOS 네이티브 메뉴바 개편

현재 `src/main/index.ts`의 메뉴 템플릿은 Electron 기본 구성(편집, 보기, 윈도우)으로 앱과 무관한 항목이 많음. DB Player에 맞게 재구성.

**제거**
- `편집` 메뉴 전체 (undo/redo/cut/copy/paste는 CodeMirror가 자체 처리)
- `보기` 메뉴의 reload, forceReload (새로고침 단축키는 이미 `before-input-event`로 막음)
- `보기` 메뉴의 resetZoom, zoomIn, zoomOut
- `윈도우` 메뉴 전체

**추가**
- `파일` 메뉴: 새 쿼리 탭 (`Cmd+T`), 탭 닫기 (`Cmd+W`)
- `보기` 메뉴: 개발자 도구, 전체 화면만 유지
- `윈도우` 메뉴: 최소화, 맨 앞으로만 유지

**IPC 연동 필요 항목**
- 새 쿼리 탭: 메뉴 클릭 시 렌더러로 IPC 전송 → `NewTabDialog` 오픈
- 탭 닫기: 메뉴 클릭 시 렌더러로 IPC 전송 → 현재 활성 탭 닫기

**플랫폼별 동작**
- macOS: 화면 최상단 시스템 메뉴바에 표시
- Windows: `autoHideMenuBar: false` — 항시 표시

---

## 4. [x] 키보드 단축키 팔레트

`Cmd+K`로 명령어를 빠르게 검색하고 실행.

- 전역 단축키 `Cmd+K` → `CommandPalette.svelte` 모달 오픈
- 검색 input + 명령어 목록 (fuzzy match)
- 초기 명령어 목록:
  - 새 쿼리 탭 열기
  - 쿼리 실행
  - 쿼리 포맷
  - 연결 전환 (저장된 연결 목록)
  - 테마 전환 (라이트/다크)
  - 히스토리 열기
- 명령어는 중앙 registry(`commands.ts`)에서 관리, 각 컴포넌트가 등록하는 방식
- 키보드 탐색 (↑↓ 이동, Enter 실행, Escape 닫기)
