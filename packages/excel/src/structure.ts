import { MAX_COLS, MAX_ROWS } from "./address";

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const LAST_ROW = MAX_ROWS - 1;
const LAST_COL = MAX_COLS - 1;

/** 행·열 삽입이나 삭제 한 번 */
export interface StructureChange {
  readonly kind: "insert" | "delete";
  readonly axis: "row" | "col";
  /** 넣을 자리(이 줄 앞에 넣는다) 또는 지울 첫 줄. 0부터 센다. */
  readonly index: number;
  /** 넣거나 지울 줄 수. 1 이상 */
  readonly count: number;
}

/** change를 되돌리는 변경. (삽입 ↔ 삭제) */
export function inverseChange(change: StructureChange): StructureChange {
  return { ...change, kind: change.kind === "insert" ? "delete" : "insert" };
}

/** 이 축의 마지막 줄 번호 (Excel 시트 최대 크기 기준) */
function lastLine(change: StructureChange): number {
  return change.axis === "row" ? LAST_ROW : LAST_COL;
}

/**
 * 줄 번호(행 또는 열)가 변경 뒤 어디로 가는지. 지워졌거나 시트 끝 밖으로 밀려나면 null
 * 삽입: 넣은 자리와 그 뒤는 count만큼 밀린다. 삭제: 지운 줄 뒤는 count만큼 당겨진다.
 */
export function mapLine(change: StructureChange, line: number): number | null {
  const { index, count } = change;
  if (line < index) return line;
  if (change.kind === "insert") return line + count > lastLine(change) ? null : line + count;
  return line < index + count ? null : line - count;
}

/**
 * 줄 구간 [first, last]가 변경 뒤 어떻게 되는지. 구간이 모두 지워지면 null (Excel과 같음)
 * - 삽입: 구간 안쪽(first 다음 줄부터 last까지)에 넣으면 늘어나고, first 앞에 넣으면 통째로 밀리고, last 뒤에 넣으면 그대로다.
 * - 삭제: 지운 줄만큼 줄어든다. first나 last가 지워지면 남은 쪽 끝까지 줄어든다.
 */
export function mapSpan(change: StructureChange, first: number, last: number): [number, number] | null {
  const { index, count } = change;
  if (change.kind === "insert") {
    const max = lastLine(change);
    const newFirst = first >= index ? first + count : first;
    const newLast = last >= index ? Math.min(last + count, max) : last;
    return newFirst > max ? null : [newFirst, newLast];
  }
  const end = index + count; // 지운 줄 다음 줄
  const newFirst = first < index ? first : first >= end ? first - count : index;
  const newLast = last >= end ? last - count : last < index ? last : index - 1;
  return newFirst > newLast ? null : [newFirst, newLast];
}

/**
 * 변경이 구간의 뜻을 바꾸는지. 통째로 밀리거나 그대로면 false,
 * 늘어나거나(안쪽에 삽입) 줄어들거나 없어지면(겹치게 삭제) true다.
 * 셀 하나는 first = last로 물으면 된다. (셀 하나는 삽입으로 뜻이 바뀌지 않는다)
 */
export function changesSpan(change: StructureChange, first: number, last: number): boolean {
  const { index, count } = change;
  if (change.kind === "insert") return first < index && index <= last;
  return first < index + count && last >= index;
}
