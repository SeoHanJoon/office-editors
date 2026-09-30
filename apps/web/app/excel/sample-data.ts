import { Sheet } from "@office/excel";

/** 예시 시트 크기 */
export const SAMPLE_ROWS = 1000;
export const SAMPLE_COLS = 26;

const FAMILY = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
const GIVEN = ["민준", "서연", "도윤", "하은", "시우", "지우", "주원", "서아", "하준", "지안", "은우", "수아"];
const TEAMS = ["영업", "개발", "디자인", "인사", "재무", "마케팅"];

/** 1행은 제목, 2행부터 1,000행까지 직원 목록이 채워진 1,000행 × 26열(A~Z) 시트. 매번 같은 값이 나온다. */
export function createSampleSheet(): Sheet {
  const data: string[][] = [["번호", "이름", "부서", "점수"]];
  for (let i = 1; i < SAMPLE_ROWS; i++) {
    data.push([
      String(i),
      FAMILY[i % FAMILY.length]! + GIVEN[(i * 7) % GIVEN.length]!,
      TEAMS[(i * 5) % TEAMS.length]!,
      String(40 + ((i * 37) % 61)),
    ]);
  }
  return new Sheet({ rowCount: SAMPLE_ROWS, colCount: SAMPLE_COLS, data });
}
