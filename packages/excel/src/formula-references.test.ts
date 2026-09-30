import { describe, expect, test } from "vitest";
import { parseA1, type CellRange } from "./address";
import { parseFormula } from "./formula-parser";
import {
  copyMapping,
  mapExpr,
  moveMapping,
  rewriteFormula,
  structureMapping,
  type ReferenceMapping,
} from "./formula-references";
import type { StructureChange } from "./structure";

/** "3행 앞에 2줄 삽입"처럼 Excel 화면 번호(1부터)로 변경을 만든다. */
function rows(kind: StructureChange["kind"], row: number, count = 1): StructureChange {
  return { kind, axis: "row", index: row - 1, count };
}

function cols(kind: StructureChange["kind"], column: string, count = 1): StructureChange {
  return { kind, axis: "col", index: parseA1(`${column}1`)!.col, count };
}

function range(a1: string): CellRange {
  const [start, end = start] = a1.split(":");
  const from = parseA1(start!)!;
  const to = parseA1(end!)!;
  return { top: from.row, left: from.col, bottom: to.row, right: to.col };
}

const structure = (change: StructureChange) => (formula: string) => rewriteFormula(formula, structureMapping(change));

describe("행 삽입", () => {
  test("넣은 자리와 그 아래를 가리키는 참조는 밀리고 위는 그대로다", () => {
    const insert = structure(rows("insert", 5));
    expect(insert("=A5")).toBe("=A6");
    expect(insert("=A4+A7")).toBe("=A4+A8");
  });

  test("$가 붙은 절대 참조도 밀린다", () => {
    expect(structure(rows("insert", 5))("=$A$5+A$5+$A5")).toBe("=$A$6+A$6+$A6");
  });

  test("여러 줄을 넣으면 그만큼 밀린다", () => {
    expect(structure(rows("insert", 2, 3))("=B2")).toBe("=B5");
  });

  // 조사 결과(ADR 참고): =SUM(A2:A4)
  test.each([
    [1, "=SUM(A3:A5)"], // 범위 위: 통째로 밀림
    [2, "=SUM(A3:A5)"], // 첫 행 앞: 통째로 밀림
    [3, "=SUM(A2:A5)"], // 안쪽: 늘어남
    [4, "=SUM(A2:A5)"], // 마지막 행 앞: 늘어남
    [5, "=SUM(A2:A4)"], // 마지막 행 뒤: 그대로
  ])("=SUM(A2:A4)에서 %i행 앞에 넣으면 %s", (row, expected) => {
    expect(structure(rows("insert", row))("=SUM(A2:A4)")).toBe(expected);
  });

  test("행 삽입은 열 번호를 바꾸지 않는다", () => {
    expect(structure(rows("insert", 1))("=SUM(B1:D1)")).toBe("=SUM(B2:D2)");
  });
});

describe("행 삭제", () => {
  test("지운 셀을 가리키던 참조는 #REF!가 된다", () => {
    expect(structure(rows("delete", 5))("=A5+1")).toBe("=#REF!+1");
  });

  test("지운 행 아래는 당겨지고 위는 그대로다", () => {
    const remove = structure(rows("delete", 3));
    expect(remove("=A7")).toBe("=A6");
    expect(remove("=A2")).toBe("=A2");
  });

  test.each([
    ["=SUM(A3:A4)", 3, 1, "=SUM(A3:A3)"],
    ["=SUM(A3:A4)", 4, 1, "=SUM(A3:A3)"],
    ["=SUM(A3:A4)", 3, 2, "=SUM(#REF!)"],
    ["=SUM(A2:A5)", 3, 1, "=SUM(A2:A4)"],
    ["=SUM(A2:A5)", 1, 3, "=SUM(A1:A2)"],
    ["=SUM(A2:A5)", 4, 5, "=SUM(A2:A3)"],
  ])("%s에서 %i행부터 %i줄을 지우면 %s", (formula, row, count, expected) => {
    expect(structure(rows("delete", row, count))(formula)).toBe(expected);
  });

  test("거꾸로 쓴 범위도 끝마다 옮긴다", () => {
    expect(structure(rows("delete", 1))("=SUM(A5:A2)")).toBe("=SUM(A4:A1)");
  });
});

describe("열 삽입·삭제", () => {
  test("열을 넣으면 그 열과 오른쪽 참조가 밀린다", () => {
    const insert = structure(cols("insert", "B"));
    expect(insert("=A1+B1+$C$2")).toBe("=A1+C1+$D$2");
    expect(insert("=SUM(A1:C1)")).toBe("=SUM(A1:D1)");
  });

  test("열을 지우면 그 열을 가리키던 참조는 #REF!, 오른쪽은 당겨진다", () => {
    const remove = structure(cols("delete", "B"));
    expect(remove("=A1+B1+C1")).toBe("=A1+#REF!+B1");
    expect(remove("=SUM(A1:C3)")).toBe("=SUM(A1:B3)");
  });

  test("Z열 뒤에 넣으면 AA열 이름으로 쓴다", () => {
    expect(structure(cols("insert", "Z"))("=Z1")).toBe("=AA1");
  });
});

describe("글자 보존", () => {
  const insert = structure(rows("insert", 1));

  test("참조 말고 다른 글자(띄어쓰기, 소문자 함수 이름)는 그대로 둔다", () => {
    expect(insert("=sum( A1 ,  b2 )*2")).toBe("=sum( A2 ,  B3 )*2");
  });

  test("바뀌지 않는 참조는 소문자도 그대로 둔다", () => {
    expect(structure(rows("insert", 5))("=a1+a9")).toBe("=a1+A10");
  });

  test("큰따옴표 안 글자와 참조처럼 보이는 함수 이름은 건드리지 않는다", () => {
    expect(insert('="A1"&A1')).toBe('="A1"&A2');
    expect(insert("=LOG10(A1)")).toBe("=LOG10(A2)");
  });

  test("수식이 아니면 그대로다", () => {
    expect(insert("A1")).toBe("A1");
  });

  test("글자를 나눌 수 없는 수식은 그대로 둔다", () => {
    expect(insert("=A1 ? B1")).toBe("=A1 ? B1");
  });

  test("바뀐 것이 없으면 같은 글자를 돌려준다", () => {
    expect(structure(rows("insert", 9))("=SUM(A1:A3)+1")).toBe("=SUM(A1:A3)+1");
  });
});

describe("복사", () => {
  const copy = (formula: string, rowOffset: number, colOffset: number) =>
    rewriteFormula(formula, copyMapping(rowOffset, colOffset));

  test("상대 참조는 옮긴 만큼 따라간다", () => {
    expect(copy("=B4*C4", 1, 2)).toBe("=D5*E5");
  });

  test("$가 붙은 쪽은 그대로다", () => {
    expect(copy("=$A$2+$B$2", 3, 3)).toBe("=$A$2+$B$2");
    expect(copy("=$A1+A$1", 1, 1)).toBe("=$A2+B$1");
  });

  test("범위도 끝마다 따라간다", () => {
    expect(copy("=SUM(A1:B2)", 2, 0)).toBe("=SUM(A3:B4)");
  });

  test("시트 밖으로 나가는 참조는 #REF!이고 범위는 통째로 #REF!다", () => {
    expect(copy("=A1+1", -1, 0)).toBe("=#REF!+1");
    expect(copy("=SUM(A1:A3)", -1, 0)).toBe("=SUM(#REF!)");
    expect(copy("=A1", 0, -1)).toBe("=#REF!");
  });
});

describe("잘라내 옮기기", () => {
  const move = (formula: string, source: string, rowOffset: number, colOffset: number) =>
    rewriteFormula(formula, moveMapping(range(source), rowOffset, colOffset));

  test("옮긴 셀을 가리키던 참조는 새 위치를 따라간다 ($ 포함)", () => {
    expect(move("=A1+1", "A1", 0, 2)).toBe("=C1+1");
    expect(move("=$A$1", "A1", 0, 2)).toBe("=$C$1");
  });

  test("옮긴 영역 밖을 가리키는 참조는 그대로다 (옮겨진 수식 자신도)", () => {
    expect(move("=B1", "A1", 0, 3)).toBe("=B1");
  });

  test("범위는 옮긴 영역 안에 통째로 있을 때만 따라간다", () => {
    expect(move("=SUM(A1:A3)", "A1:A3", 0, 1)).toBe("=SUM(B1:B3)");
    expect(move("=SUM(A1:A3)", "A2", 0, 1)).toBe("=SUM(A1:A3)");
    expect(move("=SUM(A2:A3)", "A1:A5", 0, 1)).toBe("=SUM(B2:B3)");
  });

  test("붙여넣어 덮어쓴 자리를 가리키던 참조는 #REF!다", () => {
    expect(move("=C1", "A1", 0, 2)).toBe("=#REF!");
    expect(move("=SUM(C1:C2)", "A1:A2", 0, 2)).toBe("=SUM(#REF!)");
  });

  test("옮긴 영역과 덮어쓴 자리가 겹치면 옮긴 영역이 먼저다", () => {
    // A1:A2를 한 칸 아래로: A2는 A3으로 따라가고, 덮어쓴 A3은 #REF!
    expect(move("=A2+A3", "A1:A2", 1, 0)).toBe("=A3+#REF!");
  });
});

describe("구문 나무 바꾸기", () => {
  const mappings: [string, ReferenceMapping][] = [
    ["행 삭제", structureMapping(rows("delete", 2, 2))],
    ["열 삽입", structureMapping(cols("insert", "B", 2))],
    ["복사", copyMapping(-1, 1)],
    ["잘라내기", moveMapping(range("A1:B2"), 2, 0)],
  ];
  const formulas = ["=A1+B2*$C$3", "=SUM(A1:A5,B2:C3)-A$4", "=-A2%&B3", "=AVERAGE(A3:B3)", '=IF(A1>1,"A1",B9)'];

  test.each(mappings)("%s: 글자를 고친 뒤 다시 읽은 나무와 같다", (_, mapping) => {
    for (const formula of formulas) {
      expect(mapExpr(parseFormula(formula), mapping)).toEqual(parseFormula(rewriteFormula(formula, mapping)));
    }
  });

  test("바뀐 것이 없으면 같은 객체를 돌려준다", () => {
    const expr = parseFormula("=SUM(A1:A3)+B1");
    expect(mapExpr(expr, structureMapping(rows("insert", 9)))).toBe(expr);
  });
});
