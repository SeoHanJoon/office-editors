import { describe, expect, test } from "vitest";
import { FormulaSyntaxError, findFormulaProblem, parseFormula, type Expr } from "./formula-parser";

/** 구문 나무를 괄호로 묶은 글자로 바꿔 우선순위를 한눈에 보게 한다. */
function show(expr: Expr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "string":
      return JSON.stringify(expr.value);
    case "boolean":
      return expr.value ? "TRUE" : "FALSE";
    case "error":
      return expr.code;
    case "ref":
      return refText(expr.ref);
    case "range":
      return `${refText(expr.start)}:${refText(expr.end)}`;
    case "name":
      return `name(${expr.name})`;
    case "unary":
      return `(${expr.operator}${show(expr.operand)})`;
    case "percent":
      return `(${show(expr.operand)}%)`;
    case "binary":
      return `(${show(expr.left)}${expr.operator}${show(expr.right)})`;
    case "call":
      return `${expr.name}(${expr.args.map(show).join(",")})`;
    case "missing":
      return "_";
  }
}

function refText(ref: { row: number; col: number; rowAbsolute: boolean; colAbsolute: boolean }): string {
  return `${ref.colAbsolute ? "$" : ""}${String.fromCharCode(65 + ref.col)}${ref.rowAbsolute ? "$" : ""}${ref.row + 1}`;
}

const parse = (input: string) => show(parseFormula(input));

function syntaxError(input: string): FormulaSyntaxError {
  try {
    parseFormula(input);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return error;
    throw error;
  }
  throw new Error(`문법 오류가 나야 한다: ${input}`);
}

describe("값 읽기", () => {
  test("숫자, 글자, 논리값, 에러 값을 읽는다", () => {
    expect(parse("=12.5")).toBe("12.5");
    expect(parse("=.5e1")).toBe("5");
    expect(parse('="한글"')).toBe('"한글"');
    expect(parse('="say ""hi"""')).toBe('"say \\"hi\\""');
    expect(parse("=true")).toBe("TRUE");
    expect(parse("=#div/0!")).toBe("#DIV/0!");
  });

  test("셀 참조와 범위를 읽는다. 소문자도 된다", () => {
    expect(parse("=a1")).toBe("A1");
    expect(parse("=A1:C3")).toBe("A1:C3");
    expect(parse("=$A$1+A$1+$A1")).toBe("(($A$1+A$1)+$A1)");
  });

  test("열 이름이 XFD를 넘거나 행이 0이면 셀이 아니라 이름이다", () => {
    expect(parse("=XFD1")).not.toContain("name");
    expect(parse("=XFE1")).toBe("name(XFE1)");
    expect(parse("=A0")).toBe("name(A0)");
    expect(parse("=합계")).toBe("name(합계)");
  });

  test("함수 이름은 대문자로 바꾸고, 괄호가 바로 붙어야 함수다", () => {
    expect(parse("=sum(A1:A3, 2)")).toBe("SUM(A1:A3,2)");
    expect(parse("=LOG10(1)")).toBe("LOG10(1)");
    expect(parse("=NOPE()")).toBe("NOPE()");
  });

  test("빈 인자 자리는 missing으로 남긴다", () => {
    expect(parse("=SUM(1,)")).toBe("SUM(1,_)");
    expect(parse("=SUM(,1)")).toBe("SUM(_,1)");
  });

  test("연산자 사이 빈 칸은 무시한다", () => {
    expect(parse("= 1 +  2 ")).toBe("(1+2)");
  });
});

describe("연산자 우선순위 (Excel과 같음)", () => {
  test("곱셈·나눗셈이 덧셈·뺄셈보다 먼저다", () => {
    expect(parse("=1+2*3-4/2")).toBe("((1+(2*3))-(4/2))");
  });

  test("괄호가 가장 먼저다", () => {
    expect(parse("=(1+2)*3")).toBe("((1+2)*3)");
  });

  test("부호는 ^보다 먼저다: -2^2는 (-2)^2", () => {
    expect(parse("=-2^2")).toBe("((-2)^2)");
    expect(parse("=2^-1")).toBe("(2^(-1))");
  });

  test("^는 왼쪽부터 묶는다: 2^3^2는 (2^3)^2", () => {
    expect(parse("=2^3^2")).toBe("((2^3)^2)");
  });

  test("%는 ^보다 먼저, 부호보다 나중이다", () => {
    expect(parse("=-50%")).toBe("(-(50%))");
    expect(parse("=2^50%")).toBe("(2^(50%))");
  });

  test("&는 덧셈보다 나중, 비교보다 먼저다", () => {
    expect(parse('=1+2&"a"')).toBe('((1+2)&"a")');
    expect(parse('=A1&"x"="1x"')).toBe('((A1&"x")="1x")');
  });

  test("비교 연산자를 모두 읽는다", () => {
    for (const op of ["=", "<>", "<", ">", "<=", ">="]) {
      expect(parse(`=1${op}2`)).toBe(`(1${op}2)`);
    }
  });
});

describe("문법 오류", () => {
  test("=로 시작하지 않으면 수식이 아니다", () => {
    expect(syntaxError("1+2").position).toBe(0);
  });

  test("수식이 중간에 끝나면 끝 위치를 알려준다", () => {
    for (const input of ["=", "=1+", "=SUM(", "=(1"]) {
      expect(syntaxError(input).position, input).toBe(input.length);
    }
  });

  test("괄호 짝이 안 맞으면 오류다", () => {
    expect(syntaxError("=(1+2").message).toContain("닫는 괄호");
    expect(syntaxError("=1+2)").position).toBe(4);
  });

  test("값 두 개가 연산자 없이 붙어 있으면 오류다", () => {
    expect(syntaxError("=1 2").position).toBe(3);
    expect(syntaxError("=A1 B1").position).toBe(4);
  });

  test("닫히지 않은 글자, 모르는 에러 값, 쓸 수 없는 글자는 오류다", () => {
    expect(syntaxError('="abc').message).toContain("큰따옴표");
    expect(syntaxError("=#ABC").position).toBe(1);
    expect(syntaxError("=1;2").position).toBe(2);
    expect(syntaxError("=$1").position).toBe(1);
  });

  test("아는 함수의 인자 개수가 맞지 않으면 오류다", () => {
    expect(syntaxError("=1+SUM()")).toMatchObject({ position: 3, message: expect.stringContaining("너무 적습니다") });
    expect(syntaxError(`=SUM(${Array(256).fill(1).join(",")})`).message).toContain("너무 많습니다");
    expect(parse(`=SUM(${Array(255).fill(1).join(",")})`)).toMatch(/^SUM\(/);
  });

  test("범위 : 뒤에 셀 주소가 없으면 오류다", () => {
    expect(syntaxError("=A1:1").message).toContain("범위");
  });
});

describe("셀 입력 검사", () => {
  test("수식이 아닌 입력과 문법이 맞는 수식은 문제가 없다", () => {
    expect(findFormulaProblem("")).toBeNull();
    expect(findFormulaProblem("1+")).toBeNull();
    expect(findFormulaProblem("=SUM(A1:A3)")).toBeNull();
  });

  test("문법이 틀린 수식이면 오류와 위치를 돌려준다", () => {
    expect(findFormulaProblem("=1+")).toMatchObject({ position: 3 });
    expect(findFormulaProblem("=SUM()")).toBeInstanceOf(FormulaSyntaxError);
  });
});
