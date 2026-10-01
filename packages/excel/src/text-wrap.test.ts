import { describe, expect, test } from "vitest";
import { wrapText } from "./text-wrap";

/** 글자당 10px */
const measure = (text: string) => text.length * 10;

describe("wrapText", () => {
  test("들어가면 그대로 한 줄이다", () => {
    expect(wrapText("가나다", 30, measure)).toEqual(["가나다"]);
    expect(wrapText("", 30, measure)).toEqual([""]);
  });

  test("넘치면 마지막 공백에서 나누고 줄 끝 공백은 남기지 않는다", () => {
    expect(wrapText("ab cd ef", 50, measure)).toEqual(["ab cd", "ef"]);
    expect(wrapText("월요일 화요일 수요일", 70, measure)).toEqual(["월요일 화요일", "수요일"]);
  });

  test("공백 없는 긴 낱말은 글자 단위로 나눈다", () => {
    expect(wrapText("abcdefg", 30, measure)).toEqual(["abc", "def", "g"]);
    expect(wrapText("x abcdefg", 30, measure)).toEqual(["x", "abc", "def", "g"]);
  });

  test("줄바꿈 문자에서 먼저 나눈다", () => {
    expect(wrapText("ab\ncd ef gh", 50, measure)).toEqual(["ab", "cd ef", "gh"]);
    expect(wrapText("a\r\n\r\nb", 50, measure)).toEqual(["a", "", "b"]);
  });

  test("한 글자도 안 들어가는 너비면 한 글자씩 둔다", () => {
    expect(wrapText("abc", 5, measure)).toEqual(["a", "b", "c"]);
  });
});
