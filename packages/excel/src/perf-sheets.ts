import { Sheet } from "./sheet";

/**
 * 성능 측정용 시트. `pnpm bench`와 대용량 테스트가 같이 쓴다. (README "Excel 성능 목표")
 * 크기는 모두 10만 행 × 50열이다.
 */
export const PERF_ROWS = 100_000;
export const PERF_COLS = 50;

/** A1=1, A2=A1+1, …, A{n}=A{n-1}+1. A1을 바꾸면 n-1개 수식이 줄줄이 다시 계산된다. */
export function chainSheet(n = 10_000): Sheet {
  const data = [["1"]];
  for (let row = 2; row <= n; row++) data.push([`=A${row - 1}+1`]);
  return new Sheet({ rowCount: PERF_ROWS, colCount: PERF_COLS, data });
}

/** A1:A{n}에 숫자, B1에 `=SUM(A1:A{n})` 하나 */
export function bigSumSheet(n = PERF_ROWS): Sheet {
  const data: string[][] = [];
  for (let row = 0; row < n; row++) data.push([String(row % 100), row === 0 ? `=SUM(A1:A${n})` : ""]);
  return new Sheet({ rowCount: PERF_ROWS, colCount: PERF_COLS, data });
}

/**
 * 행마다 범위 수식이 있는 성적표. 1행은 제목, 2행부터 n행까지 채운다.
 * A 번호, B 이름, C 부서, D~F 점수, G `=SUM(D2:F2)`, H `=AVERAGE(D2:F2)`,
 * J1 "총점 합계", K1 `=SUM(G2:G{n})`.
 */
export function scoreSheet(n = PERF_ROWS): Sheet {
  const data: string[][] = [["번호", "이름", "부서", "국어", "영어", "수학", "총점", "평균", "", "총점 합계", `=SUM(G2:G${n})`]];
  for (let row = 2; row <= n; row++) {
    const i = row - 1;
    data.push([
      String(i),
      `학생${i}`,
      `${(i % 6) + 1}반`,
      String(40 + ((i * 37) % 61)),
      String(40 + ((i * 53) % 61)),
      String(40 + ((i * 71) % 61)),
      `=SUM(D${row}:F${row})`,
      `=AVERAGE(D${row}:F${row})`,
    ]);
  }
  return new Sheet({ rowCount: PERF_ROWS, colCount: PERF_COLS, data });
}

/** 10만 × 50칸을 모두 숫자로 채운 시트 (500만 칸) */
export function fullSheet(): Sheet {
  const data: string[][] = [];
  for (let row = 0; row < PERF_ROWS; row++) {
    const values: string[] = [];
    for (let col = 0; col < PERF_COLS; col++) values.push(String((row + col) % 1000));
    data.push(values);
  }
  return new Sheet({ rowCount: PERF_ROWS, colCount: PERF_COLS, data });
}
