import { Sheet } from "@office/excel";

/** 예시 시트 크기 (README Step 5 성능 목표: 10만 행 × 50열) */
export const SAMPLE_ROWS = 100_000;
export const SAMPLE_COLS = 50;

const FAMILY = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
const GIVEN = ["민준", "서연", "도윤", "하은", "시우", "지우", "주원", "서아", "하준", "지안", "은우", "수아"];
const TEAMS = ["영업", "개발", "디자인", "인사", "재무", "마케팅"];

/**
 * 10만 행 × 50열(A~AX) 성적표. 매번 같은 값이 나온다.
 * - 1행은 제목, 2행부터 100,000행까지 한 사람씩: A 번호, B 이름, C 부서, D~F 국어·영어·수학 점수
 * - G 총점 `=SUM(D2:F2)`, H 평균 `=AVERAGE(D2:F2)` — 행마다 범위 수식이 있다.
 * - J1 "총점 합계", K1 `=SUM(G2:G100000)` — 점수 하나를 고치면 10만 칸을 다시 더한다.
 */
export function createSampleSheet(): Sheet {
  const data: string[][] = [
    ["번호", "이름", "부서", "국어", "영어", "수학", "총점", "평균", "", "총점 합계", `=SUM(G2:G${SAMPLE_ROWS})`],
  ];
  for (let i = 1; i < SAMPLE_ROWS; i++) {
    const row = i + 1;
    data.push([
      String(i),
      FAMILY[i % FAMILY.length]! + GIVEN[(i * 7) % GIVEN.length]!,
      TEAMS[(i * 5) % TEAMS.length]!,
      String(40 + ((i * 37) % 61)),
      String(40 + ((i * 53) % 61)),
      String(40 + ((i * 71) % 61)),
      `=SUM(D${row}:F${row})`,
      `=AVERAGE(D${row}:F${row})`,
    ]);
  }
  return new Sheet({ rowCount: SAMPLE_ROWS, colCount: SAMPLE_COLS, data });
}
