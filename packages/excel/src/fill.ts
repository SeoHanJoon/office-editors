import type { CellAddress, CellRange } from "./address";
import { pasteCopyChanges } from "./clipboard";
import { copyMapping, rewriteFormula } from "./formula-references";
import { formatNumber, isFormula, parseNumber } from "./formula-value";
import type { Direction } from "./selection";
import type { CellChange, Sheet } from "./sheet";

/** 이어 채울 때 순서대로 도는 목록. 같은 글자가 여러 목록에 있으면 앞 목록을 쓴다. (`May`) (ADR 0033) */
const FILL_LISTS: readonly (readonly string[])[] = [
  ["일", "월", "화", "수", "목", "금", "토"],
  ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
  ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"],
];

/** 끝에 붙은 숫자. 15자리를 넘으면 숫자로 정확히 다룰 수 없어 글자로 둔다. */
const TRAILING_NUMBER = /^(.*\D)?(\d{1,15})$/s;

/** 원래 칸 하나의 종류 */
type Item =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "text-number"; readonly prefix: string; readonly digits: number; readonly value: number }
  | { readonly kind: "list"; readonly list: number; readonly index: number; readonly text: string }
  | { readonly kind: "copy"; readonly text: string };

function classify(text: string): Item {
  if (isFormula(text)) return { kind: "copy", text };
  const number = parseNumber(text);
  if (number !== null) return { kind: "number", value: number };
  const lower = text.toLowerCase();
  for (let list = 0; list < FILL_LISTS.length; list++) {
    const index = FILL_LISTS[list]!.indexOf(lower);
    if (index >= 0) return { kind: "list", list, index, text };
  }
  const match = TRAILING_NUMBER.exec(text);
  if (match) return { kind: "text-number", prefix: match[1] ?? "", digits: match[2]!.length, value: Number(match[2]) };
  return { kind: "copy", text };
}

/** 앞 칸과 같은 묶음으로 이어지는지. 숫자는 모두, 글자+숫자는 앞부분이 같을 때, 목록은 같은 목록일 때 */
function sameGroup(a: Item, b: Item): boolean {
  if (a.kind === "number") return b.kind === "number";
  if (a.kind === "text-number") return b.kind === "text-number" && a.prefix === b.prefix;
  if (a.kind === "list") return b.kind === "list" && a.list === b.list;
  return false;
}

/** 묶음 안 x번째(0부터, 원래 칸 밖이면 음수이거나 길이 이상) 값 */
type Series = (x: number) => string;

/**
 * 묶음 칸 위치(0, 1, 2…)에 대해 가장 잘 맞는 직선 (최소제곱 추세). 칸이 하나면 기울기는 single이다.
 * 간격이 일정한 값이면 그 간격을 그대로 따른다. (1, 3 → 5, 7)
 */
function trend(values: readonly number[], single: number): (x: number) => number {
  const n = values.length;
  if (n === 1) return (x) => values[0]! + single * x;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let top = 0;
  let bottom = 0;
  values.forEach((value, x) => {
    top += (x - meanX) * (value - meanY);
    bottom += (x - meanX) ** 2;
  });
  const slope = top / bottom;
  return (x) => meanY + slope * (x - meanX);
}

/** 영어 목록 글자의 대소문자 모양(`mon`, `Mon`, `MON`)을 word에 입힌다. 한글은 그대로다. */
function matchCase(sample: string, word: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
  if (sample[0] !== sample[0]!.toLowerCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

/** 같은 묶음 칸들(items)의 이어가기. lineLength는 원래 줄의 칸 수다. 숫자 한 칸만 있는 줄은 복사한다. */
function groupSeries(items: readonly Item[], lineLength: number): Series {
  const first = items[0]!;
  switch (first.kind) {
    case "number": {
      const line = trend(
        items.map((item) => (item as { value: number }).value),
        lineLength === 1 ? 0 : 1,
      );
      return (x) => formatNumber(line(x));
    }
    case "text-number": {
      const line = trend(
        items.map((item) => (item as { value: number }).value),
        1,
      );
      // 0 아래로 내려가면 빼기표 없이 숫자만 쓴다. (Excel 경험적 동작, ADR 0033)
      return (x) => first.prefix + String(Math.abs(Math.round(line(x)))).padStart(first.digits, "0");
    }
    case "list": {
      const words = FILL_LISTS[first.list]!;
      // 목록 끝에서 처음으로 넘어간 것을 펴서(토, 일 → 6, 7) 직선을 구한다.
      const indexes: number[] = [];
      for (const item of items as readonly { index: number }[]) {
        const previous = indexes.at(-1);
        indexes.push(previous === undefined ? item.index : previous + mod(item.index - previous, words.length));
      }
      const line = trend(indexes, 1);
      return (x) => matchCase(first.text, words[mod(Math.round(line(x)), words.length)]!);
    }
    case "copy":
      return () => first.text;
  }
}

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * 한 줄(texts, 채우는 방향 순서)을 이어간 값. position은 원래 첫 칸에서 떨어진 칸 수다.
 * (아래·오른쪽이면 texts.length 이상, 위·왼쪽이면 음수) 수식 칸은 null이다. 원래 칸을 옮겨 써야 한다.
 */
export function lineSeries(texts: readonly string[]): (position: number) => { readonly from: number; readonly value: string | null } {
  const items = texts.map(classify);
  const groupOf: { readonly series: Series; readonly start: number; readonly length: number }[] = [];
  for (let start = 0; start < items.length; ) {
    let end = start + 1;
    while (end < items.length && sameGroup(items[start]!, items[end]!)) end++;
    const group = { series: groupSeries(items.slice(start, end), items.length), start, length: end - start };
    for (let i = start; i < end; i++) groupOf.push(group);
    start = end;
  }
  return (position) => {
    const from = mod(position, texts.length);
    if (isFormula(texts[from]!)) return { from, value: null };
    const round = Math.floor(position / texts.length);
    const group = groupOf[from]!;
    return { from, value: group.series(round * group.length + from - group.start) };
  };
}

/**
 * source 범위를 direction 쪽으로 count칸 이어 채우는 변경. (채우기 핸들)
 * 채우는 방향의 줄마다 따로 이어가고, 수식은 붙여넣기처럼 `$`가 없는 참조만 옮긴다. (ADR 0033)
 */
export function fillChanges(sheet: Sheet, source: CellRange, direction: Direction, count: number): CellChange[] {
  const vertical = direction === "up" || direction === "down";
  const forward = direction === "down" || direction === "right";
  const [start, end] = vertical ? [source.top, source.bottom] : [source.left, source.right];
  const [crossStart, crossEnd] = vertical ? [source.left, source.right] : [source.top, source.bottom];
  const changes: CellChange[] = [];
  for (let cross = crossStart; cross <= crossEnd; cross++) {
    const at = (along: number): CellAddress => (vertical ? { row: along, col: cross } : { row: cross, col: along });
    const texts: string[] = [];
    for (let along = start; along <= end; along++) texts.push(sheet.get(at(along)));
    const series = lineSeries(texts);
    for (let step = 1; step <= count; step++) {
      const position = forward ? texts.length - 1 + step : -step;
      const { from, value } = series(position);
      const address = at(start + position);
      if (value !== null) {
        changes.push({ address, value });
      } else {
        const offset = position - from;
        const mapping = vertical ? copyMapping(offset, 0) : copyMapping(0, offset);
        changes.push({ address, value: rewriteFormula(texts[from]!, mapping) });
      }
    }
  }
  return changes;
}

/** 채우기 핸들을 끌어 놓은 결과 */
export type FillDrag =
  /** source를 direction 쪽으로 count칸 채운다. range는 채운 뒤 고를 범위(원래 범위 포함) */
  | { readonly kind: "fill"; readonly direction: Direction; readonly count: number; readonly range: CellRange }
  /** source 중 range만 남기고 cleared를 지운다. */
  | { readonly kind: "shrink"; readonly range: CellRange; readonly cleared: CellRange };

/**
 * 채우기 핸들을 cell까지 끌었을 때 할 일. 아무것도 하지 않으면 null이다. (Excel과 같음)
 * - 원래 범위 밖이면 더 멀리 나간 방향(같으면 세로) 하나로만 채운다.
 * - 원래 범위 안이면 cell 뒤쪽 줄을 지운다. 더 많이 줄어드는 축(같으면 행)을 쓴다.
 */
export function fillDrag(source: CellRange, cell: CellAddress): FillDrag | null {
  const below = cell.row - source.bottom;
  const above = source.top - cell.row;
  const right = cell.col - source.right;
  const left = source.left - cell.col;
  const vertical = Math.max(below, above);
  const horizontal = Math.max(right, left);
  if (vertical > 0 || horizontal > 0) {
    if (vertical >= horizontal) {
      return below > 0
        ? { kind: "fill", direction: "down", count: below, range: { ...source, bottom: cell.row } }
        : { kind: "fill", direction: "up", count: above, range: { ...source, top: cell.row } };
    }
    return right > 0
      ? { kind: "fill", direction: "right", count: right, range: { ...source, right: cell.col } }
      : { kind: "fill", direction: "left", count: left, range: { ...source, left: cell.col } };
  }
  const rowsCut = source.bottom - cell.row;
  const colsCut = source.right - cell.col;
  if (rowsCut === 0 && colsCut === 0) return null;
  if (rowsCut >= colsCut) {
    return { kind: "shrink", range: { ...source, bottom: cell.row }, cleared: { ...source, top: cell.row + 1 } };
  }
  return { kind: "shrink", range: { ...source, right: cell.col }, cleared: { ...source, left: cell.col + 1 } };
}

/** range 안에서 값이 있는 칸을 비우는 변경 */
export function clearChanges(sheet: Sheet, range: CellRange): CellChange[] {
  const changes: CellChange[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      if (sheet.get({ row, col }) !== "") changes.push({ address: { row, col }, value: "" });
    }
  }
  return changes;
}

/**
 * 채우기 핸들을 두 번 클릭했을 때 아래로 채울 마지막 행. 채울 곳이 없으면 null이다.
 * - 바로 왼쪽 열에서 원래 범위 아래로 값이 이어진 곳까지 채운다. 왼쪽 열 바로 아래 칸이 비었으면 오른쪽 열을 본다.
 * - 채울 열 안에 이미 값이 있으면 그 앞에서 멈춘다. (덮어쓰지 않음)
 * 둘 다 Excel의 경험적 동작을 따랐다. (ADR 0033)
 */
export function autoFillEnd(sheet: Sheet, source: CellRange): number | null {
  const first = source.bottom + 1;
  if (first >= sheet.rowCount) return null;
  const filled = (row: number, col: number) => col >= 0 && col < sheet.colCount && sheet.get({ row, col }) !== "";
  const side = [source.left - 1, source.right + 1].find((col) => filled(first, col));
  if (side === undefined) return null;
  let last = first;
  while (last + 1 < sheet.rowCount && filled(last + 1, side)) last++;
  for (let row = first; row <= last; row++) {
    for (let col = source.left; col <= source.right; col++) {
      if (filled(row, col)) return row === first ? null : row - 1;
    }
  }
  return last;
}

/**
 * Ctrl+D(down)·Ctrl+R(right): 범위의 첫 행(열)을 나머지 칸에 복사하는 변경. 이어가지 않고 붙여넣기처럼 복사한다.
 * 한 행(열)만 골랐으면 바로 위 행(왼쪽 열)을 복사해 온다. 그런 줄이 없으면 빈 배열이다. (Excel과 같음)
 */
export function copyFillChanges(sheet: Sheet, range: CellRange, direction: "down" | "right"): CellChange[] {
  if (direction === "down") {
    if (range.top === range.bottom) {
      if (range.top === 0) return [];
      return pasteCopyChanges(sheet, { ...range, top: range.top - 1, bottom: range.top - 1 }, range);
    }
    return pasteCopyChanges(sheet, { ...range, bottom: range.top }, { ...range, top: range.top + 1 });
  }
  if (range.left === range.right) {
    if (range.left === 0) return [];
    return pasteCopyChanges(sheet, { ...range, left: range.left - 1, right: range.left - 1 }, range);
  }
  return pasteCopyChanges(sheet, { ...range, right: range.left }, { ...range, left: range.left + 1 });
}

/**
 * Ctrl+Enter: 활성 셀(active)에 입력한 text를 range의 모든 칸에 넣는 변경.
 * 수식은 칸마다 활성 셀에서 떨어진 만큼 `$`가 없는 참조를 옮긴다. (Excel과 같음)
 */
export function fillEntryChanges(text: string, active: CellAddress, range: CellRange): CellChange[] {
  const formula = isFormula(text);
  const changes: CellChange[] = [];
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      const value = formula ? rewriteFormula(text, copyMapping(row - active.row, col - active.col)) : text;
      changes.push({ address: { row, col }, value });
    }
  }
  return changes;
}
