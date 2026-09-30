# 0009. 표 화면: React 없는 GridView와 브라우저 기본 스크롤

- 상태: 채택
- 날짜: 2026-09-30
- 관련 Step: Step 2

## 배경
Canvas로 그린 표를 화면에 붙여야 한다. 규칙상 `excel` 패키지는 `command-core`, `ui`만 import한다.
화면을 누가 만들지(React와의 경계)와 1,000행(나중에 10만 행)을 어떻게 스크롤할지 정해야 한다.

## 선택지
- React 경계
  - A안 `excel`은 React 없이 `GridView` 클래스만 내보내고 `apps/web`이 얇게 감싼다: 의존 규칙 그대로, 로직을 React 없이 테스트 / 감싸는 코드가 `apps/web`에 생김
  - B안 `excel`이 `<Spreadsheet />` React 컴포넌트를 내보낸다: 쓰는 쪽이 간단 / `excel`에 React 의존 추가(규칙 변경)
- 스크롤
  - A안 브라우저 기본 스크롤: 표 전체 크기의 빈 div로 스크롤바를 만들고 Canvas는 화면에 고정해 스크롤 위치만큼 다시 그림. 휠·관성·스크롤바는 브라우저가 처리 / 브라우저 최대 높이(약 1,700만~3,300만 px) 제한
  - B안 직접 만든 스크롤: 휠을 직접 받아 계산하고 스크롤바도 Canvas에 그림. 크기 제한 없음 / 만들 것이 많음

## 결정
- React 경계는 A안. `new GridView(container, sheet)`가 container 안에 Canvas와 스크롤 영역을 만들고, `selection`, `visibleRange`, `onSelectionChange`, `focus`, `destroy`를 제공한다. `apps/web/app/excel/spreadsheet.tsx`가 `useEffect`에서 만들고 없앤다.
- 스크롤은 A안. Canvas(화면 크기, 보이는 칸만 그림) 위에 투명한 스크롤 영역을 덮고 그 안에 표 전체 크기의 빈 div를 둔다. 스크롤 영역이 마우스·키보드 이벤트를 받는다. 다시 그리기는 `requestAnimationFrame`으로 한 프레임에 한 번만 한다.
- 위치 계산(보이는 범위, 좌표 → 셀, 셀이 보이게 스크롤)과 키 처리(`navigate`)는 DOM 없는 순수 함수로 두고 단위 테스트한다.

## 결과
- 브라우저가 스크롤을 처리하므로 트랙패드 관성, 스크롤바 드래그가 따로 코드 없이 된다.
- 10만 행 × 20px = 200만 px라 Step 5까지는 높이 제한에 걸리지 않는다. Excel 최대 행(약 2,100만 px)을 쓰면 Firefox 제한(약 1,700만 px)을 넘으므로 그때 스크롤 위치를 비율로 바꾸는 보정이 필요하다.
- 스크롤은 픽셀 단위라 Excel처럼 행 단위로 딱 맞춰 멈추지 않는다. 맨 위 행이 반쯤 잘려 보일 수 있다.
- `GridView`는 DOM이 필요해 단위 테스트하지 않고 브라우저 테스트로 확인한다.
