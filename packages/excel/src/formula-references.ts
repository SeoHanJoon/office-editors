import { MAX_COLS, MAX_ROWS, columnName, type CellRange } from "./address";
import { rangeOf } from "./formula-evaluate";
import { FormulaSyntaxError, tokenize, type CellRef, type Expr } from "./formula-parser";
import { mapLine, mapSpan, type StructureChange } from "./structure";

/**
 * 수식 안 참조를 어디로 옮길지 정하는 규칙. 복사, 잘라내기, 행·열 삽입/삭제마다 하나씩 있다.
 * 바뀌지 않는 참조는 받은 객체를 그대로 돌려준다. (바뀐 것만 글자를 고치려고 같은 객체인지로 판단한다)
 * 가리키던 셀이 없어지면 null이다. 수식에서는 `#REF!`가 된다.
 */
export interface ReferenceMapping {
  cell(ref: CellRef): CellRef | null;
  range(start: CellRef, end: CellRef): readonly [CellRef, CellRef] | null;
}

const REF_ERROR = "#REF!";
const REF_EXPR: Expr = { kind: "error", code: "#REF!" };

/** 참조를 수식 글자로 쓴다. ($A$1, A$1, $A1, A1) */
export function formatRef({ row, col, rowAbsolute, colAbsolute }: CellRef): string {
  return `${colAbsolute ? "$" : ""}${columnName(col)}${rowAbsolute ? "$" : ""}${row + 1}`;
}

/**
 * 수식 글자에서 참조 부분만 mapping대로 바꿔 끼운다. 나머지 글자(띄어쓰기, 소문자, 괄호)는 그대로 둔다.
 * 수식이 아니거나 글자를 나눌 수 없으면(쓸 수 없는 글자) 그대로 돌려준다.
 */
export function rewriteFormula(input: string, mapping: ReferenceMapping): string {
  if (!input.startsWith("=")) return input;
  let tokens;
  try {
    tokens = tokenize(input);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return input;
    throw error;
  }
  let result = "";
  let copied = 0; // input에서 result로 옮긴 곳까지
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type !== "ref") continue;
    const colon = tokens[i + 1]!;
    const second = tokens[i + 2];
    let text: string;
    let end: number;
    // 파서와 같이 "참조 : 참조"를 범위 하나로 본다.
    if (colon.type === "op" && colon.op === ":" && second?.type === "ref") {
      i += 2;
      const mapped = mapping.range(token.ref, second.ref);
      if (mapped && mapped[0] === token.ref && mapped[1] === second.ref) continue;
      text = mapped ? `${formatRef(mapped[0])}:${formatRef(mapped[1])}` : REF_ERROR;
      end = second.end;
    } else {
      const mapped = mapping.cell(token.ref);
      if (mapped === token.ref) continue;
      text = mapped ? formatRef(mapped) : REF_ERROR;
      end = token.end;
    }
    result += input.slice(copied, token.pos) + text;
    copied = end;
  }
  return copied === 0 ? input : result + input.slice(copied);
}

/** 구문 나무의 참조를 mapping대로 바꾼다. rewriteFormula한 글자를 다시 읽은 것과 같은 나무가 된다. 바뀐 것이 없으면 expr 그대로 */
export function mapExpr(expr: Expr, mapping: ReferenceMapping): Expr {
  switch (expr.kind) {
    case "ref": {
      const ref = mapping.cell(expr.ref);
      if (ref === expr.ref) return expr;
      return ref ? { kind: "ref", ref } : REF_EXPR;
    }
    case "range": {
      const mapped = mapping.range(expr.start, expr.end);
      if (mapped && mapped[0] === expr.start && mapped[1] === expr.end) return expr;
      return mapped ? { kind: "range", start: mapped[0], end: mapped[1] } : REF_EXPR;
    }
    case "unary":
    case "percent": {
      const operand = mapExpr(expr.operand, mapping);
      return operand === expr.operand ? expr : { ...expr, operand };
    }
    case "binary": {
      const left = mapExpr(expr.left, mapping);
      const right = mapExpr(expr.right, mapping);
      return left === expr.left && right === expr.right ? expr : { ...expr, left, right };
    }
    case "call": {
      let changed = false;
      const args = expr.args.map((arg) => {
        const mapped = mapExpr(arg, mapping);
        if (mapped !== arg) changed = true;
        return mapped;
      });
      return changed ? { ...expr, args } : expr;
    }
    default:
      return expr;
  }
}

function inSheet(row: number, col: number): boolean {
  return row >= 0 && col >= 0 && row < MAX_ROWS && col < MAX_COLS;
}

/**
 * 수식을 (rowOffset, colOffset)만큼 떨어진 셀로 복사할 때. `$`가 없는 쪽만 옮긴다.
 * 시트 밖으로 나가는 참조는 #REF!이고, 범위는 한쪽 끝만 나가도 통째로 #REF!다. (Excel과 같음)
 */
export function copyMapping(rowOffset: number, colOffset: number): ReferenceMapping {
  const cell = (ref: CellRef): CellRef | null => {
    const row = ref.rowAbsolute ? ref.row : ref.row + rowOffset;
    const col = ref.colAbsolute ? ref.col : ref.col + colOffset;
    if (row === ref.row && col === ref.col) return ref;
    return inSheet(row, col) ? { ...ref, row, col } : null;
  };
  return {
    cell,
    range(start, end) {
      const first = cell(start);
      const second = cell(end);
      return first && second ? [first, second] : null;
    },
  };
}

/**
 * 행·열을 넣거나 지울 때. `$`와 상관없이 옮긴다. (`$`는 복사할 때만 뜻이 있다)
 * 지운 셀을 가리키면 #REF!, 범위는 구간 규칙(mapSpan)대로 늘고 줄며, 모두 지워지면 #REF!다.
 */
export function structureMapping(change: StructureChange): ReferenceMapping {
  const byRow = change.axis === "row";
  const line = (ref: CellRef) => (byRow ? ref.row : ref.col);
  const withLine = (ref: CellRef, value: number): CellRef =>
    line(ref) === value ? ref : byRow ? { ...ref, row: value } : { ...ref, col: value };
  return {
    cell(ref) {
      const mapped = mapLine(change, line(ref));
      return mapped === null ? null : withLine(ref, mapped);
    },
    range(start, end) {
      const a = line(start);
      const b = line(end);
      const span = mapSpan(change, Math.min(a, b), Math.max(a, b));
      if (!span) return null;
      // 거꾸로 쓴 범위(A5:A1)는 거꾸로 둔 채 끝마다 옮긴다.
      const [first, last] = a <= b ? span : [span[1], span[0]];
      return [withLine(start, first), withLine(end, last)];
    },
  };
}

function contains(outer: CellRange, row: number, col: number): boolean {
  return row >= outer.top && row <= outer.bottom && col >= outer.left && col <= outer.right;
}

/**
 * source 범위를 잘라내 (rowOffset, colOffset)만큼 옮길 때. 시트의 모든 수식(옮겨지는 수식 포함)에 쓴다.
 * - source 안을 가리키는 참조는 `$`와 상관없이 새 위치를 따라간다. 범위는 source 안에 통째로 들어 있을 때만 따라간다.
 * - 붙여넣어 덮어쓴 자리(source 밖)를 가리키는 참조는 #REF!다. 범위는 덮어쓴 자리 안에 통째로 들어 있을 때만 #REF!다.
 * - 나머지는 그대로다. 옮겨진 수식도 source 밖을 가리키는 참조는 그대로 둔다. (복사와 다름)
 */
export function moveMapping(source: CellRange, rowOffset: number, colOffset: number): ReferenceMapping {
  const target: CellRange = {
    top: source.top + rowOffset,
    left: source.left + colOffset,
    bottom: source.bottom + rowOffset,
    right: source.right + colOffset,
  };
  const shift = (ref: CellRef): CellRef =>
    rowOffset === 0 && colOffset === 0 ? ref : { ...ref, row: ref.row + rowOffset, col: ref.col + colOffset };
  const inRange = (outer: CellRange, range: CellRange) =>
    contains(outer, range.top, range.left) && contains(outer, range.bottom, range.right);
  return {
    cell(ref) {
      if (contains(source, ref.row, ref.col)) return shift(ref);
      if (contains(target, ref.row, ref.col)) return null; // source와 겹치지 않는 덮어쓴 자리
      return ref;
    },
    range(start, end) {
      const range = rangeOf(start, end);
      if (inRange(source, range)) return [shift(start), shift(end)];
      if (inRange(target, range)) return null;
      return [start, end];
    },
  };
}
