import { describe, expect, it } from "vitest";
import type { CellRange } from "./address";
import { RangeIndex } from "./range-index";

function containing(index: RangeIndex, row: number, col: number): number[] {
  const owners: number[] = [];
  index.forEachContaining(row, col, (owner) => owners.push(owner));
  return owners.sort((a, b) => a - b);
}

const range = (top: number, left: number, bottom: number, right: number): CellRange => ({ top, left, bottom, right });

describe("RangeIndex", () => {
  it("셀을 포함하는 범위의 수식만 찾는다", () => {
    const index = new RangeIndex();
    index.add(1, [range(0, 0, 9, 0)]); // A1:A10
    index.add(2, [range(4, 1, 4, 3)]); // B5:D5
    index.add(3, [range(20, 0, 30, 5)]); // A21:F31

    expect(containing(index, 4, 0)).toEqual([1]);
    expect(containing(index, 4, 2)).toEqual([2]);
    expect(containing(index, 25, 5)).toEqual([3]);
    expect(containing(index, 10, 0)).toEqual([]);
    expect(containing(index, 4, 4)).toEqual([]);
  });

  it("범위의 네 모서리 셀도 포함한다", () => {
    const index = new RangeIndex();
    index.add(1, [range(2, 3, 5, 7)]);

    for (const [row, col] of [[2, 3], [2, 7], [5, 3], [5, 7]] as const) {
      expect(containing(index, row, col)).toEqual([1]);
    }
    for (const [row, col] of [[1, 3], [6, 7], [2, 2], [5, 8]] as const) {
      expect(containing(index, row, col)).toEqual([]);
    }
  });

  it("한 수식이 셀을 포함하는 범위를 여러 개 가지면 그 수만큼 찾는다", () => {
    const index = new RangeIndex();
    index.add(1, [range(0, 0, 9, 0), range(5, 0, 5, 0), range(20, 0, 20, 0)]);

    expect(containing(index, 5, 0)).toEqual([1, 1]);
  });

  it("remove하면 그 수식의 범위를 모두 뺀다", () => {
    const index = new RangeIndex();
    index.add(1, [range(0, 0, 9, 0), range(0, 1, 9, 1)]);
    index.add(2, [range(0, 0, 9, 0)]);

    index.remove(1);

    expect(containing(index, 3, 0)).toEqual([2]);
    expect(containing(index, 3, 1)).toEqual([]);
  });

  it("같은 수식을 다시 add하면 이전 범위를 바꾼다", () => {
    const index = new RangeIndex();
    index.add(1, [range(0, 0, 9, 0)]);

    index.add(1, [range(50, 0, 59, 0)]);

    expect(containing(index, 3, 0)).toEqual([]);
    expect(containing(index, 55, 0)).toEqual([1]);
  });

  it("없는 수식을 remove해도 괜찮다", () => {
    const index = new RangeIndex();
    index.remove(7);
    index.add(7, []);

    expect(containing(index, 0, 0)).toEqual([]);
  });

  it("무작위로 넣고 빼도 모든 범위를 하나씩 확인한 결과와 같다", () => {
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const index = new RangeIndex();
    const expected = new Map<number, CellRange[]>();

    for (let step = 0; step < 3000; step++) {
      const owner = random(300);
      if (random(4) === 0) {
        index.remove(owner);
        expected.delete(owner);
      } else {
        const ranges = Array.from({ length: 1 + random(3) }, () => {
          const top = random(200);
          const left = random(20);
          return range(top, left, top + random(random(5) === 0 ? 150 : 5), left + random(4));
        });
        index.add(owner, ranges);
        expected.set(owner, ranges);
      }
      if (step % 50 !== 0) continue;
      for (let probe = 0; probe < 40; probe++) {
        const row = random(210);
        const col = random(25);
        const brute: number[] = [];
        for (const [o, ranges] of expected) {
          for (const r of ranges) if (row >= r.top && row <= r.bottom && col >= r.left && col <= r.right) brute.push(o);
        }
        expect(containing(index, row, col)).toEqual(brute.sort((a, b) => a - b));
      }
    }
  });

  it("위에서부터 차례로 10만 개를 넣어도 스택이 넘치지 않고 빨리 찾는다", () => {
    const index = new RangeIndex();
    for (let row = 0; row < 100_000; row++) index.add(row, [range(row, 0, row, 2)]);

    const start = performance.now();
    for (let row = 0; row < 100_000; row += 7) expect(containing(index, row, 1)).toEqual([row]);
    // 한쪽으로 치우친 트리(높이 10만)라면 수 초가 걸린다. 넉넉한 기준만 둔다.
    expect(performance.now() - start).toBeLessThan(1000);

    for (let row = 0; row < 100_000; row++) index.remove(row);
    expect(containing(index, 500, 1)).toEqual([]);
  });
});
