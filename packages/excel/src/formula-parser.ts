import { parseA1, type CellAddress } from "./address";
import { TYPED_ERROR_CODES, type ErrorCode } from "./formula-value";

/** 수식 안의 셀 참조. `$`가 붙은 쪽은 절대 참조다. (복사·행 삽입 때 쓴다: Step 6) */
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

type Token =
  | { type: "number"; value: number; pos: number }
  | { type: "string"; value: string; pos: number }
  | { type: "boolean"; value: boolean; pos: number }
  | { type: "error"; code: ErrorCode; pos: number }
  | { type: "ref"; ref: CellRef; pos: number }
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

const OPERATORS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%", "(", ")", ",", ":"];
const REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_.(])/;
const NAME = /^[\p{L}_\\][\p{L}\p{N}_.]*/u;
const NUMBER = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 1; // "=" 다음부터
  while (pos < input.length) {
    const rest = input.slice(pos);
    const char = rest[0]!;
    if (char === " " || char === "\n") {
      pos++;
      continue;
    }
    const number = NUMBER.exec(rest);
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
      const code = TYPED_ERROR_CODES.find((c) => rest.toUpperCase().startsWith(c));
      if (!code) throw new FormulaSyntaxError("알 수 없는 에러 값입니다.", pos);
      tokens.push({ type: "error", code, pos });
      pos += code.length;
      continue;
    }
    const ref = REF.exec(rest);
    const address = ref && parseA1(ref[2]! + ref[4]!);
    if (ref && address) {
      tokens.push({ type: "ref", ref: { ...address, colAbsolute: ref[1] === "$", rowAbsolute: ref[3] === "$" }, pos });
      pos += ref[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      const text = name[0];
      const upper = text.toUpperCase();
      if (input[pos + text.length] === "(") tokens.push({ type: "function", name: upper, pos });
      else if (upper === "TRUE" || upper === "FALSE") tokens.push({ type: "boolean", value: upper === "TRUE", pos });
      else tokens.push({ type: "name", name: text, pos });
      pos += text.length;
      continue;
    }
    const op = OPERATORS.find((o) => rest.startsWith(o));
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
        return this.call(token.name);
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

  /** 함수 이름 다음의 `(인자, ...)`를 읽는다. 빈 인자 자리는 missing이다. */
  private call(name: string): Expr {
    this.expectOp("(", "여는 괄호가 없습니다.");
    const args: Expr[] = [];
    if (this.peekOp(")")) {
      this.index++;
      return { kind: "call", name, args };
    }
    for (;;) {
      args.push(this.peekOp(",") || this.peekOp(")") ? { kind: "missing" } : this.comparison());
      if (this.peekOp(",")) {
        this.index++;
        continue;
      }
      this.expectOp(")", "닫는 괄호())가 없습니다.");
      return { kind: "call", name, args };
    }
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
