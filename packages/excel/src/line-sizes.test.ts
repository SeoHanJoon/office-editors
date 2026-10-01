import { describe, expect, test } from "vitest";
import { LineSizes } from "./line-sizes";

describe("크기가 모두 같을 때", () => {
  const sizes = new LineSizes(100, 20);

  test("위치는 줄 번호 × 기본 크기다", () => {
    expect(sizes.offset(0)).toBe(0);
    expect(sizes.offset(3)).toBe(60);
    expect(sizes.total).toBe(2000);
    expect(sizes.size(7)).toBe(20);
  });

  test("위치가 들어 있는 줄을 찾는다. 경계는 뒤 줄에 속한다", () => {
    expect(sizes.lineAt(0)).toBe(0);
    expect(sizes.lineAt(19.9)).toBe(0);
    expect(sizes.lineAt(20)).toBe(1);
  });

  test("범위 밖 위치는 첫 줄이나 마지막 줄이 된다", () => {
    expect(sizes.lineAt(-5)).toBe(0);
    expect(sizes.lineAt(1_000_000)).toBe(99);
  });
});

describe("크기가 다른 줄이 있을 때", () => {
  // 0:20 1:20 2:50 3:20 4:5 5:20 …
  const sizes = new LineSizes(10, 20, [
    [4, 5],
    [2, 50],
  ]);

  test("다른 줄의 크기와 그 뒤 줄의 위치가 바뀐다", () => {
    expect(sizes.size(2)).toBe(50);
    expect(sizes.size(4)).toBe(5);
    expect(sizes.size(3)).toBe(20);
    expect([0, 1, 2, 3, 4, 5, 6].map((line) => sizes.offset(line))).toEqual([0, 20, 40, 90, 110, 115, 135]);
    expect(sizes.total).toBe(10 * 20 + 30 - 15);
  });

  test("위치로 줄을 찾는다", () => {
    expect(sizes.lineAt(39)).toBe(1);
    expect(sizes.lineAt(40)).toBe(2);
    expect(sizes.lineAt(89)).toBe(2);
    expect(sizes.lineAt(90)).toBe(3);
    expect(sizes.lineAt(112)).toBe(4);
    expect(sizes.lineAt(115)).toBe(5);
    expect(sizes.lineAt(140)).toBe(6);
  });

  test("다른 줄을 번호 순서대로 돌려준다", () => {
    expect([...sizes.custom()]).toEqual([
      [2, 50],
      [4, 5],
    ]);
  });

  test("줄 수 밖의 줄과 기본 크기와 같은 줄은 무시한다", () => {
    const ignored = new LineSizes(3, 20, [
      [1, 20],
      [5, 40],
    ]);

    expect([...ignored.custom()]).toEqual([]);
    expect(ignored.total).toBe(60);
  });

  test("0 이하 크기는 받지 않는다", () => {
    expect(() => new LineSizes(3, 20, [[1, 0]])).toThrow(RangeError);
    expect(() => new LineSizes(3, 0)).toThrow(RangeError);
  });
});

test("무작위 크기에서도 하나씩 더한 답과 같다", () => {
  // 고정 시드 난수 (매번 같은 결과)
  let seed = 7;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);

  for (let round = 0; round < 50; round++) {
    const count = 1 + Math.floor(random() * 60);
    const all = Array.from({ length: count }, () => (random() < 0.3 ? 1 + Math.floor(random() * 80) : 20));
    // 순서를 섞어서 넘겨도 된다.
    const custom = all.map((size, line) => [line, size] as const).sort(() => random() - 0.5);
    const sizes = new LineSizes(count, 20, custom);

    let position = 0;
    for (let line = 0; line < count; line++) {
      expect(sizes.size(line)).toBe(all[line]);
      expect(sizes.offset(line)).toBe(position);
      expect(sizes.lineAt(position)).toBe(line);
      expect(sizes.lineAt(position + all[line]! - 0.5)).toBe(line);
      position += all[line]!;
    }
    expect(sizes.total).toBe(position);
    expect(sizes.lineAt(position)).toBe(count - 1);
  }
});
