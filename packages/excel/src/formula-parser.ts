import { MAX_COLS, MAX_ROWS, type CellAddress } from "./address";
import { FUNCTIONS } from "./formula-functions";
import { TYPED_ERROR_CODES, type ErrorCode } from "./formula-value";

/** 수식 안의 셀 참조. `$`가 붙은 쪽은 절대 참조다. (복사할 때 `$`가 붙은 쪽은 옮기지 않는다) */
export interface CellRef extends CellAddress {
  readonly rowAbsolute: boolean;
  readonly colAbsolute: boolean;
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";

/** 수식을 읽은 결과(구문 나무). 계산기는 이 나무를 따라 값을 구한다. */
export type Expr =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error"; readonly code: ErrorCode }
  | { readonly kind: "ref"; readonly ref: CellRef }
  | { readonly kind: "range"; readonly start: CellRef; readonly end: CellRef }
  /** 함수도 셀 참조도 아닌 이름. 계산하면 #NAME? */
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "unary"; readonly operator: "+" | "-"; readonly operand: Expr }
  | { readonly kind: "percent"; readonly operand: Expr }
  | { readonly kind: "binary"; readonly operator: BinaryOperator; readonly left: Expr; readonly right: Expr }
  /** name은 대문자로 바꿔 둔다. */
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Expr[] }
  /** 함수 인자 자리가 비어 있음. `SUM(1,)`의 두 번째 인자 */
  | { readonly kind: "missing" };

/** 수식 문법이 틀렸다. position은 문제가 난 글자 위치(0부터, "=" 포함)다. */
export class FormulaSyntaxError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "FormulaSyntaxError";
    this.position = position;
  }
}

/** 수식 글자를 나눈 조각. pos는 조각이 시작하는 글자 위치("=" 포함)다. */
export type Token =
  | { type: "number"; value: number; pos: number }
  | { type: "string"; value: string; pos: number }
  | { type: "boolean"; value: boolean; pos: number }
  | { type: "error"; code: ErrorCode; pos: number }
  /** end는 참조 글자가 끝난 다음 위치다. (참조만 바꿔 끼울 때 쓴다) */
  | { type: "ref"; ref: CellRef; pos: number; end: number }
  | { type: "name"; name: string; pos: number }
  | { type: "function"; name: string; pos: number }
  | { type: "op"; op: string; pos: number }
  | { type: "end"; pos: number };

/**
 * "="로 시작하는 수식을 읽어 구문 나무로 바꾼다. 문법이 틀리면 FormulaSyntaxError를 던진다.
 *
 * 연산자 우선순위(높은 것부터, Excel과 같음): `:` → 부호 `-` → `%` → `^` → `* /` → `+ -` → `&` → 비교
 * Excel처럼 `-2^2`는 4, `2^3^2`는 64다. (부호가 `^`보다 먼저이고, `^`는 왼쪽부터 계산)
 */
export function parseFormula(input: string): Expr {
  if (!input.startsWith("=")) throw new FormulaSyntaxError("수식은 =로 시작해야 합니다.", 0);
  return new Parser(tokenize(input)).parse();
}

/** 셀 입력이 문법이 틀린 수식이면 그 오류, 아니면(수식이 아니거나 문법이 맞으면) null */
export function findFormulaProblem(input: string): FormulaSyntaxError | null {
  if (!input.startsWith("=")) return null;
  try {
    parseFormula(input);
    return null;
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return error;
    throw error;
  }
}

/** 큰 반복문에서 다른 파일의 이름을 매번 부르지 않도록 한 번 읽어 둔다. (ADR 0022) */
const ROW_LIMIT = MAX_ROWS;
const COL_LIMIT = MAX_COLS;

/** 한 글자 연산자. 두 글자(<>, <=, >=)는 따로 본다. */
const OPERATORS = new Set(["+", "-", "*", "/", "^", "&", "=", "<", ">", "%", "(", ")", ",", ":"]);
// 글자를 잘라 새로 만들지 않도록 y(sticky) 정규식을 lastIndex 자리에 대 본다. (행 삽입 때 수식 20만 개를 다시 읽는다)
const REF = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_.(])/y;
const NAME = /[\p{L}_\\][\p{L}\p{N}_.]*/uy;
const NUMBER = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;

/** regex를 input의 pos 자리에 대 본다. */
function matchAt(regex: RegExp, input: string, pos: number): RegExpExecArray | null {
  regex.lastIndex = pos;
  return regex.exec(input);
}

/** "A1"의 열 글자와 행 숫자로 주소를 만든다. 시트 밖이거나 행이 0으로 시작하면 null (parseA1과 같은 규칙) */
function refAddress(letters: string, digits: string): CellAddress | null {
  if (digits.length > 7 || digits.charCodeAt(0) === 48 /* 0 */) return null;
  let col = 0;
  for (let i = 0; i < letters.length; i++) col = col * 26 + ((letters.charCodeAt(i) | 32) - 96);
  const row = Number(digits);
  if (col > COL_LIMIT || row > ROW_LIMIT) return null;
  return { row: row - 1, col: col - 1 };
}

/**
 * "="로 시작하는 수식을 조각으로 나눈다. 쓸 수 없는 글자가 있으면 FormulaSyntaxError. 마지막 조각은 늘 "end"다.
 * 첫 글자를 보고 맞을 수 있는 정규식만 대 본다.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 1; // "=" 다음부터
  while (pos < input.length) {
    const char = input[pos]!;
    if (char === " " || char === "\n") {
      pos++;
      continue;
    }
    const code = input.charCodeAt(pos);
    const lower = code | 32;
    const letter = lower >= 97 && lower <= 122;
    const number = (code >= 48 && code <= 57) || char === "." ? matchAt(NUMBER, input, pos) : null;
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]), pos });
      pos += number[0].length;
      continue;
    }
    if (char === '"') {
      const { value, end } = readString(input, pos);
      tokens.push({ type: "string", value, pos });
      pos = end;
      continue;
    }
    if (char === "#") {
      const code = TYPED_ERROR_CODES.find((c) => input.slice(pos, pos + c.length).toUpperCase() === c);
      if (!code) throw new FormulaSyntaxError("알 수 없는 에러 값입니다.", pos);
      tokens.push({ type: "error", code, pos });
      pos += code.length;
      continue;
    }
    const ref = letter || char === "$" ? matchAt(REF, input, pos) : null;
    const address = ref && refAddress(ref[2]!, ref[4]!);
    if (ref && address) {
      const end = pos + ref[0].length;
      tokens.push({ type: "ref", ref: { ...address, colAbsolute: ref[1] === "$", rowAbsolute: ref[3] === "$" }, pos, end });
      pos = end;
      continue;
    }
    const name = letter || char === "_" || char === "\\" || code > 127 ? matchAt(NAME, input, pos) : null;
    if (name) {
      const text = name[0];
      const upper = text.toUpperCase();
      if (input[pos + text.length] === "(") tokens.push({ type: "function", name: upper, pos });
      else if (upper === "TRUE" || upper === "FALSE") tokens.push({ type: "boolean", value: upper === "TRUE", pos });
      else tokens.push({ type: "name", name: text, pos });
      pos += text.length;
      continue;
    }
    const next = input[pos + 1];
    const op =
      (char === "<" && (next === ">" || next === "=")) || (char === ">" && next === "=")
        ? char + next
        : OPERATORS.has(char)
          ? char
          : null;
    if (!op) throw new FormulaSyntaxError(`수식에 쓸 수 없는 글자입니다: ${char}`, pos);
    tokens.push({ type: "op", op, pos });
    pos += op.length;
  }
  tokens.push({ type: "end", pos: input.length });
  return tokens;
}

/** pos의 큰따옴표부터 글자를 읽는다. 안의 `""`는 큰따옴표 하나다. */
function readString(input: string, pos: number): { value: string; end: number } {
  let value = "";
  let i = pos + 1;
  while (i < input.length) {
    if (input[i] === '"') {
      if (input[i + 1] !== '"') return { value, end: i + 1 };
      value += '"';
      i += 2;
    } else {
      value += input[i];
      i++;
    }
  }
  throw new FormulaSyntaxError("닫는 큰따옴표(\")가 없습니다.", pos);
}

const COMPARISON = ["=", "<>", "<", ">", "<=", ">="];

class Parser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Expr {
    const expr = this.comparison();
    const token = this.peek();
    if (token.type !== "end") throw this.unexpected(token);
    return expr;
  }

  private comparison(): Expr {
    return this.binary(COMPARISON, () => this.concat());
  }

  private concat(): Expr {
    return this.binary(["&"], () => this.additive());
  }

  private additive(): Expr {
    return this.binary(["+", "-"], () => this.multiplicative());
  }

  private multiplicative(): Expr {
    return this.binary(["*", "/"], () => this.power());
  }

  private power(): Expr {
    return this.binary(["^"], () => this.unary());
  }

  /** 같은 우선순위 연산자를 왼쪽부터 묶는다. */
  private binary(operators: readonly string[], next: () => Expr): Expr {
    let left = next();
    for (let token = this.peek(); token.type === "op" && operators.includes(token.op); token = this.peek()) {
      this.index++;
      left = { kind: "binary", operator: token.op as BinaryOperator, left, right: next() };
    }
    return left;
  }

  private unary(): Expr {
    const token = this.peek();
    if (token.type === "op" && (token.op === "-" || token.op === "+")) {
      this.index++;
      return { kind: "unary", operator: token.op, operand: this.unary() };
    }
    return this.percent();
  }

  private percent(): Expr {
    let expr = this.primary();
    while (this.peekOp("%")) {
      this.index++;
      expr = { kind: "percent", operand: expr };
    }
    return expr;
  }

  private primary(): Expr {
    const token = this.next();
    switch (token.type) {
      case "number":
      case "string":
      case "boolean":
        return { kind: token.type, value: token.value } as Expr;
      case "error":
        return { kind: "error", code: token.code };
      case "name":
        return { kind: "name", name: token.name };
      case "ref":
        if (!this.peekOp(":")) return { kind: "ref", ref: token.ref };
        this.index++;
        return { kind: "range", start: token.ref, end: this.expectRef() };
      case "function":
        return this.call(token.name, token.pos);
      case "op":
        if (token.op === "(") {
          const expr = this.comparison();
          this.expectOp(")", "닫는 괄호())가 없습니다.");
          return expr;
        }
        throw this.unexpected(token);
      case "end":
        throw this.unexpected(token);
    }
  }

  /**
   * 함수 이름 다음의 `(인자, ...)`를 읽는다. 빈 인자 자리는 missing이다.
   * 아는 함수인데 인자 개수가 맞지 않으면 Excel처럼 문법 오류다. 모르는 함수는 계산할 때 #NAME?
   */
  private call(name: string, pos: number): Expr {
    this.expectOp("(", "여는 괄호가 없습니다.");
    const args: Expr[] = [];
    if (this.peekOp(")")) {
      this.index++;
    } else {
      for (;;) {
        args.push(this.peekOp(",") || this.peekOp(")") ? { kind: "missing" } : this.comparison());
        if (!this.peekOp(",")) break;
        this.index++;
      }
      this.expectOp(")", "닫는 괄호())가 없습니다.");
    }
    const spec = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
    if (spec && args.length < spec.minArgs) throw new FormulaSyntaxError(`${name} 함수의 인수가 너무 적습니다.`, pos);
    if (spec && args.length > spec.maxArgs) throw new FormulaSyntaxError(`${name} 함수의 인수가 너무 많습니다.`, pos);
    return { kind: "call", name, args };
  }

  private expectRef(): CellRef {
    const token = this.next();
    if (token.type !== "ref") throw new FormulaSyntaxError("범위(:) 뒤에 셀 주소가 있어야 합니다.", token.pos);
    return token.ref;
  }

  private expectOp(op: string, message: string): void {
    const token = this.next();
    if (token.type !== "op" || token.op !== op) throw new FormulaSyntaxError(message, token.pos);
  }

  private peekOp(op: string): boolean {
    const token = this.peek();
    return token.type === "op" && token.op === op;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    const token = this.tokens[this.index]!;
    if (token.type !== "end") this.index++;
    return token;
  }

  private unexpected(token: Token): FormulaSyntaxError {
    if (token.type === "end") return new FormulaSyntaxError("수식이 끝나지 않았습니다.", token.pos);
    if (token.type === "op" && token.op === ")") return new FormulaSyntaxError("여는 괄호 없이 닫는 괄호가 있습니다.", token.pos);
    return new FormulaSyntaxError("이 자리에 올 수 없는 글자입니다.", token.pos);
  }
}
