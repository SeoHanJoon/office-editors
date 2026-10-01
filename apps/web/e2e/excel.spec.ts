import { expect, test, type Page } from "@playwright/test";

// @office/excel의 DEFAULT_LAYOUT과 같은 값 (px)
const ROW_HEIGHT = 20;
const COL_WIDTH = 64;
const HEADER_HEIGHT = 20;
const HEADER_WIDTH = 46;

const grid = (page: Page) => page.getByLabel("시트", { exact: true });
const nameBox = (page: Page) => page.getByLabel("이름 상자");
const state = (page: Page) => page.evaluate(() => window.__excel!.state());

/** 스크롤하지 않은 표에서 셀("C5")의 가운데 좌표 */
async function cellCenter(page: Page, a1: string) {
  const [, column, row] = /^([A-Z])(\d+)$/.exec(a1)!;
  const box = (await grid(page).boundingBox())!;
  return {
    x: box.x + HEADER_WIDTH + (column!.charCodeAt(0) - 65) * COL_WIDTH + COL_WIDTH / 2,
    y: box.y + HEADER_HEIGHT + (Number(row) - 1) * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
}

async function clickCell(
  page: Page,
  a1: string,
  { shift = false, button = "left" }: { shift?: boolean; button?: "left" | "right" } = {},
) {
  const { x, y } = await cellCenter(page, a1);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(x, y, { button });
  if (shift) await page.keyboard.up("Shift");
}

/** 스크롤하지 않은 표에서 행 번호(3) 또는 열 이름("C") 머리글을 누른다. */
async function clickHeader(
  page: Page,
  header: number | string,
  { shift = false, button = "left" }: { shift?: boolean; button?: "left" | "right" } = {},
) {
  const box = (await grid(page).boundingBox())!;
  const point =
    typeof header === "number"
      ? { x: box.x + HEADER_WIDTH / 2, y: box.y + HEADER_HEIGHT + (header - 1) * ROW_HEIGHT + ROW_HEIGHT / 2 }
      : { x: box.x + HEADER_WIDTH + (header.charCodeAt(0) - 65) * COL_WIDTH + COL_WIDTH / 2, y: box.y + HEADER_HEIGHT / 2 };
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y, { button });
  if (shift) await page.keyboard.up("Shift");
  return point;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/excel");
  await page.waitForFunction(() => window.__excel !== undefined);
  // 처음 열 때 수식을 나눠서 계산한다. 결과를 확인하는 테스트가 흔들리지 않도록 끝날 때까지 기다린다.
  await page.waitForFunction(() => !window.__excel!.state().calculating);
  await expect(nameBox(page)).toHaveValue("A1");
});

test("첫 페이지의 Excel 링크로 들어갈 수 있다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Excel" }).click();

  await expect(page).toHaveURL("/excel");
  await expect(grid(page)).toBeVisible();
});

test("10만 행 표를 휠로 끝까지 내리고 마지막 행을 클릭하면 선택된다", async ({ page }) => {
  const box = (await grid(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // 10만 행은 200만 px라 한 번에 크게 굴린다.
  await expect(async () => {
    await page.mouse.wheel(0, 500_000);
    expect((await state(page)).visible).toMatch(/:[A-Z]+100000$/);
  }).toPass();

  // 끝까지 스크롤하면 마지막 행이 화면 아래쪽(가로 스크롤바 위)에 딱 붙는다.
  const clientHeight = await grid(page).evaluate((el) => el.clientHeight);
  await page.mouse.click(box.x + HEADER_WIDTH + COL_WIDTH * 1.5, box.y + clientHeight - ROW_HEIGHT / 2);

  await expect(nameBox(page)).toHaveValue("B100000");
});

test("처음 열면 표가 먼저 보이고, 수식은 나눠서 계산한 뒤 총점 합계가 채워진다", async ({ page }) => {
  await page.reload();
  await page.waitForFunction(() => window.__excel !== undefined);

  // 표가 뜬 직후에는 아직 계산 중이다. 보이는 행의 총점(G2 = D2+E2+F2)은 바로 계산되고,
  // 총점 10만 개를 모두 더하는 K1은 계산이 끝날 때까지 비어 있다. (화면에는 회색 "…")
  const first = await page.evaluate(() => ({
    calculating: window.__excel!.state().calculating,
    scores: ["D2", "E2", "F2"].map((a1) => Number(window.__excel!.value(a1))),
    total: window.__excel!.value("G2"),
    sum: window.__excel!.value("K1"),
  }));
  expect(first.calculating).toBe(true);
  expect(first.total).toBe(String(first.scores[0]! + first.scores[1]! + first.scores[2]!));
  expect(first.sum).toBe("");

  await page.waitForFunction(() => !window.__excel!.state().calculating);
  const expected = await page.evaluate(() => {
    let total = 0;
    for (let row = 2; row <= 100_000; row++) total += Number(window.__excel!.value(`G${row}`));
    return String(total);
  });
  expect(await page.evaluate(() => window.__excel!.value("K1"))).toBe(expected);
});

test("셀을 클릭하면 그 셀이 선택된다", async ({ page }) => {
  await clickCell(page, "C5");

  await expect(nameBox(page)).toHaveValue("C5");
  expect((await state(page)).selection).toBe("C5");
});

test("방향키, Tab, Enter로 활성 셀을 옮긴다", async ({ page }) => {
  await clickCell(page, "B2");

  for (const [key, expected] of [
    ["ArrowRight", "C2"],
    ["ArrowDown", "C3"],
    ["ArrowLeft", "B3"],
    ["ArrowUp", "B2"],
    ["Tab", "C2"],
    ["Shift+Tab", "B2"],
    ["Enter", "B3"],
    ["Shift+Enter", "B2"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(nameBox(page)).toHaveValue(expected);
  }
});

test("Shift+방향키로 범위를 선택해도 활성 셀은 그대로다", async ({ page }) => {
  await clickCell(page, "B2");

  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");

  await expect(nameBox(page)).toHaveValue("B2");
  expect((await state(page)).selection).toBe("B2:D4");
});

test("드래그로 범위를 고르고 Shift+클릭으로 늘린다", async ({ page }) => {
  const from = await cellCenter(page, "B2");
  const to = await cellCenter(page, "D5");

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect(nameBox(page)).toHaveValue("B2");
  expect((await state(page)).selection).toBe("B2:D5");

  await clickCell(page, "E7", { shift: true });

  await expect(nameBox(page)).toHaveValue("B2");
  expect((await state(page)).selection).toBe("B2:E7");
});

test("Ctrl+방향키로 데이터 끝으로, Home과 Ctrl+Home으로 처음으로 간다", async ({ page }) => {
  await clickCell(page, "A1");

  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect(nameBox(page)).toHaveValue("A100000");
  expect((await state(page)).visible).toMatch(/100000$/);

  // 예시 시트는 A~H열까지 채워져 있다.
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await expect(nameBox(page)).toHaveValue("H100000");

  await page.keyboard.press("Home");
  await expect(nameBox(page)).toHaveValue("A100000");

  await page.keyboard.press("ControlOrMeta+Home");
  await expect(nameBox(page)).toHaveValue("A1");
  expect((await state(page)).visible).toMatch(/^A1:/);
});

test("PageDown과 PageUp은 한 화면씩 옮긴다", async ({ page }) => {
  const clientHeight = await grid(page).evaluate((el) => el.clientHeight);
  const pageRows = Math.floor((clientHeight - HEADER_HEIGHT) / ROW_HEIGHT);
  await clickCell(page, "A1");

  await page.keyboard.press("PageDown");
  await expect(nameBox(page)).toHaveValue(`A${1 + pageRows}`);
  expect((await state(page)).visible).toMatch(new RegExp(`^A${1 + pageRows}:`));

  await page.keyboard.press("PageUp");
  await expect(nameBox(page)).toHaveValue("A1");
});

test.describe("셀 값 입력", () => {
  const editor = (page: Page) => page.getByLabel("셀 입력");
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);

  /**
   * 한글 입력기처럼 자모를 조합하며 글자를 입력한다. (Chrome의 실제 조합 이벤트: compositionstart → update → end)
   * syllables는 글자마다 조합 단계를 적는다. 예: [["ㅎ", "하", "한"], ["ㄱ", "그", "글"]]
   */
  async function typeKorean(page: Page, syllables: string[][], { finish = true } = {}) {
    const cdp = await page.context().newCDPSession(page);
    for (const [index, steps] of syllables.entries()) {
      for (const text of steps) {
        await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
        // CDP 호출에는 녹화용 slowMo가 걸리지 않아서, 녹화할 때만 조합 단계가 영상에 보이도록 쉰다.
        if (process.env.RECORD === "1") await page.waitForTimeout(300);
      }
      const last = index === syllables.length - 1;
      if (!last || finish) await cdp.send("Input.insertText", { text: steps.at(-1)! });
    }
    await cdp.detach();
  }

  test("글자를 치면 입력이 시작되고, Enter로 확정하면 아래 셀로 간다", async ({ page }) => {
    await clickCell(page, "L2");

    await page.keyboard.type("Hello 123");
    await expect(editor(page)).toHaveValue("Hello 123");
    expect((await state(page)).editing).toBe("enter");

    await page.keyboard.press("Enter");

    await expect(nameBox(page)).toHaveValue("L3");
    expect(await cell(page, "L2")).toBe("Hello 123");
    expect((await state(page)).editing).toBeNull();
    await expect(editor(page)).toHaveValue("");
  });

  test("한글을 조합해서 입력해도 첫 글자가 사라지거나 두 번 들어가지 않는다", async ({ page }) => {
    await clickCell(page, "L2");

    await typeKorean(page, [["ㅎ"]], { finish: false });
    // 첫 자모부터 입력창에 들어가고 입력이 시작된다.
    await expect(editor(page)).toHaveValue("ㅎ");
    expect((await state(page)).editing).toBe("enter");

    await typeKorean(page, [["하", "한"], ["ㄱ", "그", "글"]]);
    await expect(editor(page)).toHaveValue("한글");
    await page.keyboard.press("Enter");

    expect(await cell(page, "L2")).toBe("한글");
    await expect(nameBox(page)).toHaveValue("L3");
  });

  test("한글 조합 중에 다른 셀을 누르면 조합하던 글자까지 확정되고 새 셀에는 들어가지 않는다", async ({ page }) => {
    await clickCell(page, "L2");
    await typeKorean(page, [["ㅅ", "셀"], ["ㄱ", "가"]], { finish: false });
    await expect(editor(page)).toHaveValue("셀가");

    await clickCell(page, "M5");

    await expect(nameBox(page)).toHaveValue("M5");
    expect(await cell(page, "L2")).toBe("셀가");
    expect(await cell(page, "M5")).toBe("");
    await expect(editor(page)).toHaveValue("");

    // 조합이 끝났으므로 키가 입력기에 묶이지 않고 바로 동작한다.
    await page.keyboard.press("ArrowDown");
    await expect(nameBox(page)).toHaveValue("M6");

    // 새 셀에서 바로 한글을 쳐도 첫 글자부터 들어간다.
    await typeKorean(page, [["ㄴ", "나"]]);
    await page.keyboard.press("Tab");
    expect(await cell(page, "M6")).toBe("나");
    await expect(nameBox(page)).toHaveValue("N6");
  });

  test("글자를 쳐서 시작하면 방향키가 확정하고 옮기고, F2로 시작하면 입력창 안에서 커서를 옮긴다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.type("abc");
    await page.keyboard.press("ArrowRight");

    expect(await cell(page, "L2")).toBe("abc");
    await expect(nameBox(page)).toHaveValue("M2");

    await clickCell(page, "A1");
    await page.keyboard.press("F2");
    await expect(editor(page)).toHaveValue("번호");
    expect((await state(page)).editing).toBe("edit");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    await page.keyboard.press("Enter");

    expect(await cell(page, "A1")).toBe("번X호");
    await expect(nameBox(page)).toHaveValue("A2");
  });

  test("셀을 더블클릭하면 기존 값을 고친다", async ({ page }) => {
    const { x, y } = await cellCenter(page, "B2");
    await page.mouse.dblclick(x, y);

    const before = await cell(page, "B2");
    await expect(editor(page)).toHaveValue(before);
    expect((await state(page)).editing).toBe("edit");

    await page.keyboard.type("님");
    await page.keyboard.press("Tab");

    expect(await cell(page, "B2")).toBe(`${before}님`);
    await expect(nameBox(page)).toHaveValue("C2");
  });

  test("Esc를 누르면 입력을 취소하고 원래 값이 남는다", async ({ page }) => {
    await clickCell(page, "B2");
    const before = await cell(page, "B2");

    await page.keyboard.type("취소할 값");
    await page.keyboard.press("Escape");

    expect(await cell(page, "B2")).toBe(before);
    await expect(nameBox(page)).toHaveValue("B2");
    expect((await state(page)).editing).toBeNull();
  });

  test("입력한 값을 Ctrl+Z로 되돌리고 Ctrl+Shift+Z로 다시 한다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.type("첫째");
    await page.keyboard.press("Enter");
    await page.keyboard.type("둘째");
    await page.keyboard.press("Enter");
    await expect(nameBox(page)).toHaveValue("L4");

    // 되돌리면 그 셀이 선택된다.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(nameBox(page)).toHaveValue("L3");
    expect(await cell(page, "L3")).toBe("");
    expect(await cell(page, "L2")).toBe("첫째");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(nameBox(page)).toHaveValue("L2");
    expect(await cell(page, "L2")).toBe("");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await cell(page, "L2")).toBe("첫째");
    await page.keyboard.press("ControlOrMeta+y");
    expect(await cell(page, "L3")).toBe("둘째");
    await expect(nameBox(page)).toHaveValue("L3");
  });

  test("Delete로 범위를 지우고 한 번에 되돌린다", async ({ page }) => {
    await clickCell(page, "A2");
    await clickCell(page, "C4", { shift: true });
    const before = await Promise.all(["A2", "B3", "C4"].map((a1) => cell(page, a1)));

    await page.keyboard.press("Delete");
    for (const a1 of ["A2", "B3", "C4"]) expect(await cell(page, a1)).toBe("");
    expect(await cell(page, "D2")).not.toBe("");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await Promise.all(["A2", "B3", "C4"].map((a1) => cell(page, a1)))).toEqual(before);
    expect((await state(page)).selection).toBe("A2:C4");
  });

  test("Backspace는 셀을 비우고 입력을 시작한다", async ({ page }) => {
    await clickCell(page, "B2");

    await page.keyboard.press("Backspace");
    await expect(editor(page)).toHaveValue("");
    expect((await state(page)).editing).toBe("enter");
    await page.keyboard.type("새 이름");
    await page.keyboard.press("Enter");

    expect(await cell(page, "B2")).toBe("새 이름");
  });

  test("범위를 고른 채 입력하고 Enter를 누르면 범위 안에서 다음 칸으로 간다", async ({ page }) => {
    await clickCell(page, "L2");
    await clickCell(page, "M3", { shift: true });

    for (const value of ["가", "나", "다", "라"]) {
      await page.keyboard.type(value);
      await page.keyboard.press("Enter");
    }

    expect(await Promise.all(["L2", "L3", "M2", "M3"].map((a1) => cell(page, a1)))).toEqual(["가", "나", "다", "라"]);
    // 마지막 칸 다음은 첫 칸이고, 범위는 그대로다.
    await expect(nameBox(page)).toHaveValue("L2");
    expect((await state(page)).selection).toBe("L2:M3");
  });
});

test.describe("수식", () => {
  const editor = (page: Page) => page.getByLabel("셀 입력");
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const value = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.value(a1), a1);
  // Next.js도 role="alert" 요소(페이지 이동 안내)를 두므로 글자로 좁힌다.
  const problemAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "수식에 문제가 있습니다" });

  async function enter(page: Page, a1: string, text: string) {
    await clickCell(page, a1);
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }

  test("=A2+A3을 입력하면 계산값이 보이고, 참조한 셀을 바꾸면 다시 계산된다", async ({ page }) => {
    // 예시 시트의 A열은 번호(A2=1, A3=2)다.
    await enter(page, "L2", "=A2+A3");

    expect(await cell(page, "L2")).toBe("=A2+A3");
    expect(await value(page, "L2")).toBe("3");

    await enter(page, "A2", "10");
    expect(await value(page, "L2")).toBe("12");

    // undo하면 수식 결과도 돌아간다.
    await page.keyboard.press("ControlOrMeta+z");
    expect(await value(page, "L2")).toBe("3");
  });

  test("=SUM(D2:D11)은 점수 10개의 합이다", async ({ page }) => {
    const scores = await Promise.all(Array.from({ length: 10 }, (_, i) => value(page, `D${i + 2}`)));
    const expected = scores.reduce((total, score) => total + Number(score), 0);

    await enter(page, "L2", "=sum(D2:D11)");

    expect(await value(page, "L2")).toBe(String(expected));

    // 수식 셀을 F2로 고치면 입력창에는 계산값이 아니라 수식이 보인다.
    await clickCell(page, "L2");
    await page.keyboard.press("F2");
    await expect(editor(page)).toHaveValue("=sum(D2:D11)");
  });

  test("문법이 틀린 수식은 확정되지 않고 알림이 뜨며, 고치면 확정된다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.type("=SUM(A2:A4");
    await page.keyboard.press("Enter");

    // 입력이 이어지고 다음 셀로 가지 않는다.
    await expect(problemAlert(page)).toBeVisible();
    await expect(nameBox(page)).toHaveValue("L2");
    expect((await state(page)).editing).toBe("enter");
    expect(await cell(page, "L2")).toBe("");

    // 다른 셀을 눌러도 선택이 옮겨지지 않는다.
    await clickCell(page, "N5");
    await expect(nameBox(page)).toHaveValue("L2");

    await page.keyboard.type(")");
    await expect(problemAlert(page)).toBeHidden();
    await page.keyboard.press("Enter");

    await expect(nameBox(page)).toHaveValue("L3");
    expect(await value(page, "L2")).toBe("6");
    expect((await state(page)).problem).toBeNull();
  });

  test("Esc를 누르면 틀린 수식 입력을 취소하고 알림도 사라진다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.type("=1+");
    await page.keyboard.press("Enter");
    await expect(problemAlert(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(problemAlert(page)).toBeHidden();
    expect((await state(page)).editing).toBeNull();
    expect(await cell(page, "L2")).toBe("");
  });

  test("서로를 참조하는 순환 참조는 #CYCLE!이고, 끊으면 다시 계산된다", async ({ page }) => {
    await enter(page, "L2", "=M2+1");
    await enter(page, "M2", "=L2+1");

    expect(await value(page, "L2")).toBe("#CYCLE!");
    expect(await value(page, "M2")).toBe("#CYCLE!");

    await enter(page, "M2", "5");

    expect(await value(page, "L2")).toBe("6");
  });
});

test.describe("복사/붙여넣기", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const value = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.value(a1), a1);
  const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const writeClipboard = (page: Page, text: string) => page.evaluate((text) => navigator.clipboard.writeText(text), text);

  test("범위를 복사하면 클립보드에 Excel처럼 탭과 줄바꿈으로 나눈 보이는 값이 들어가고 점선이 그려진다", async ({ page }) => {
    await clickCell(page, "E1");
    await clickCell(page, "G3", { shift: true });
    await page.keyboard.press("ControlOrMeta+c");

    const shown = await page.evaluate(() =>
      ["E", "F", "G"].map((column) => [1, 2, 3].map((row) => window.__excel!.value(`${column}${row}`))),
    );
    const rows = [0, 1, 2].map((row) => shown.map((column) => column[row]).join("\t"));
    // G열은 수식(=SUM)이지만 클립보드에는 계산값이 들어간다.
    expect(await readClipboard(page)).toBe(rows.map((row) => `${row}\r\n`).join(""));
    expect((await state(page)).copied).toBe("E1:G3");

    // Esc를 누르면 점선이 사라진다.
    await page.keyboard.press("Escape");
    expect((await state(page)).copied).toBeNull();
  });

  test("수식을 복사해 붙여넣으면 상대 참조가 옮긴 만큼 따라가고, 여러 번 붙일 수 있다", async ({ page }) => {
    await clickCell(page, "G2"); // =SUM(D2:F2)
    await page.keyboard.press("ControlOrMeta+c");

    await clickCell(page, "L3");
    await page.keyboard.press("ControlOrMeta+v");
    expect(await cell(page, "L3")).toBe("=SUM(I3:K3)");

    // 범위를 고르고 붙이면 범위 전체에 채운다. 점선은 남아 있다.
    await clickCell(page, "G5");
    await clickCell(page, "G7", { shift: true });
    await page.keyboard.press("ControlOrMeta+v");
    expect(await cell(page, "G6")).toBe("=SUM(D6:F6)");
    expect((await state(page)).copied).toBe("G2");
    expect((await state(page)).selection).toBe("G5:G7");
  });

  test("Excel에서 복사한 글자를 붙여넣으면 칸마다 들어가고, 한 번에 되돌린다", async ({ page }) => {
    // Excel이 클립보드에 넣는 모양: 탭·CRLF, 셀 안 줄바꿈은 큰따옴표로 감쌈, 마지막 줄 뒤에도 CRLF
    await writeClipboard(page, '10\t20\t=L2+M2\r\n"여러\n줄"\t\t한글\r\n');
    await clickCell(page, "L2");
    await page.keyboard.press("ControlOrMeta+v");

    expect(await Promise.all(["L2", "M2", "N2", "L3", "M3", "N3"].map((a1) => cell(page, a1)))).toEqual([
      "10",
      "20",
      "=L2+M2",
      "여러\n줄",
      "",
      "한글",
    ]);
    expect(await value(page, "N2")).toBe("30");
    expect((await state(page)).selection).toBe("L2:N3");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await Promise.all(["L2", "N2", "L3", "N3"].map((a1) => cell(page, a1)))).toEqual(["", "", "", ""]);
  });

  test("잘라내 붙여넣으면 셀이 옮겨지고, 옮긴 셀을 가리키던 수식이 따라간다", async ({ page }) => {
    const scores = await Promise.all(["D2", "E2", "F2"].map((a1) => cell(page, a1)));
    const total = await value(page, "G2");

    await clickCell(page, "D2");
    await clickCell(page, "F2", { shift: true });
    await page.keyboard.press("ControlOrMeta+x");
    await clickCell(page, "L2");
    await page.keyboard.press("ControlOrMeta+v");

    expect(await Promise.all(["L2", "M2", "N2"].map((a1) => cell(page, a1)))).toEqual(scores);
    expect(await cell(page, "D2")).toBe("");
    expect(await cell(page, "G2")).toBe("=SUM(L2:N2)");
    expect(await value(page, "G2")).toBe(total);
    // 잘라낸 것은 한 번만 붙인다.
    expect((await state(page)).copied).toBeNull();

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cell(page, "D2")).toBe(scores[0]);
    expect(await cell(page, "G2")).toBe("=SUM(D2:F2)");
  });

  test("입력 중에는 입력창 안에서 글자를 붙여넣는다", async ({ page }) => {
    await writeClipboard(page, "붙인 글자");
    await clickCell(page, "L2");
    await page.keyboard.press("F2");
    await page.keyboard.press("ControlOrMeta+v");
    await page.keyboard.press("Enter");

    expect(await cell(page, "L2")).toBe("붙인 글자");
    expect(await cell(page, "M2")).toBe("");
  });
});

test.describe("행·열 삽입/삭제", () => {
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const value = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.value(a1), a1);

  const insert = (page: Page) => page.keyboard.press("ControlOrMeta+Shift+Equal");
  const remove = (page: Page) => page.keyboard.press("ControlOrMeta+Minus");

  test("행 번호를 누르면 행 전체를, 열 이름을 누르면 열 전체를 고르고, Shift와 드래그로 늘린다", async ({ page }) => {
    await clickHeader(page, 3);
    expect((await state(page)).selection).toBe("A3:AX3");
    await expect(nameBox(page)).toHaveValue("A3");

    await clickHeader(page, 5, { shift: true });
    expect((await state(page)).selection).toBe("A3:AX5");

    const from = await clickHeader(page, "C");
    expect((await state(page)).selection).toBe("C1:C100000");
    await expect(nameBox(page)).toHaveValue("C1");

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + COL_WIDTH * 2, from.y, { steps: 4 });
    await page.mouse.up();
    expect((await state(page)).selection).toBe("C1:E100000");
  });

  test("행을 골라 Ctrl+Shift+=를 누르면 새 행이 들어가고 아래 수식 참조가 밀리며, 한 번에 되돌린다", async ({ page }) => {
    const total = await value(page, "K1");
    const first = await Promise.all(["A2", "G2"].map((a1) => cell(page, a1)));

    // 셀 범위만 고른 채 누르면 아무것도 하지 않는다. (Excel은 대화상자를 띄운다)
    await clickCell(page, "B2");
    await insert(page);
    expect((await state(page)).rowCount).toBe(100_000);

    await clickHeader(page, 2);
    await insert(page);

    expect((await state(page)).rowCount).toBe(100_001);
    expect((await state(page)).selection).toBe("A2:AX2");
    expect(await cell(page, "A2")).toBe("");
    expect(await Promise.all(["A3", "G3"].map((a1) => cell(page, a1)))).toEqual([first[0], "=SUM(D3:F3)"]);
    expect(await cell(page, "K1")).toBe("=SUM(G3:G100001)");
    expect(await value(page, "K1")).toBe(total);

    await page.keyboard.press("ControlOrMeta+z");
    expect((await state(page)).rowCount).toBe(100_000);
    expect(await Promise.all(["A2", "G2"].map((a1) => cell(page, a1)))).toEqual(first);
    expect(await cell(page, "K1")).toBe("=SUM(G2:G100000)");
  });

  test("행을 지우면 그 행을 가리키던 수식은 #REF!가 되고, 합계 범위는 줄어든다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.type("=G3*2");
    await page.keyboard.press("Enter");
    const total = Number(await value(page, "K1"));
    const removed = Number(await value(page, "G3"));

    await clickHeader(page, 3);
    await remove(page);

    expect((await state(page)).rowCount).toBe(99_999);
    expect(await cell(page, "L2")).toBe("=#REF!*2");
    expect(await value(page, "L2")).toBe("#REF!");
    expect(await cell(page, "K1")).toBe("=SUM(G2:G99999)");
    expect(Number(await value(page, "K1"))).toBe(total - removed);

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cell(page, "L2")).toBe("=G3*2");
    expect(Number(await value(page, "L2"))).toBe(removed * 2);
    expect((await state(page)).selection).toBe("A3:AX3");
  });

  test("열을 골라 넣으면 범위 안쪽에 들어간 열만큼 수식 범위가 늘어난다", async ({ page }) => {
    const total = await value(page, "G2");

    await clickHeader(page, "E");
    await insert(page);

    expect((await state(page)).colCount).toBe(51);
    expect((await state(page)).selection).toBe("E1:E100000");
    expect(await cell(page, "H2")).toBe("=SUM(D2:G2)");
    expect(await value(page, "H2")).toBe(total);
    expect(await cell(page, "L1")).toBe("=SUM(H2:H100000)");

    await remove(page);
    expect((await state(page)).colCount).toBe(50);
    expect(await cell(page, "G2")).toBe("=SUM(D2:F2)");
  });
});

test.describe("전체 선택과 줄 선택", () => {
  test("왼쪽 위 모서리를 누르거나 Ctrl/Cmd+A를 누르면 시트 전체를 고르고, 활성 셀은 그대로다", async ({ page }) => {
    await clickCell(page, "C5");
    const box = (await grid(page).boundingBox())!;
    await page.mouse.click(box.x + HEADER_WIDTH / 2, box.y + HEADER_HEIGHT / 2);
    expect((await state(page)).selection).toBe("A1:AX100000");
    await expect(nameBox(page)).toHaveValue("C5");

    await clickCell(page, "B2");
    await page.keyboard.press("ControlOrMeta+a");
    expect((await state(page)).selection).toBe("A1:AX100000");
    await expect(nameBox(page)).toHaveValue("B2");
  });

  test("Shift+Space는 고른 범위가 걸친 행 전체를, Ctrl+Space와 ⌥Space는 열 전체를 고른다", async ({ page }) => {
    await clickCell(page, "B3");
    await clickCell(page, "C4", { shift: true });

    await page.keyboard.press("Shift+Space");
    expect((await state(page)).selection).toBe("A3:AX4");
    await expect(nameBox(page)).toHaveValue("B3");
    // 공백이 입력되어 입력이 시작되지 않는다.
    expect((await state(page)).editing).toBeNull();

    // 이어서 Shift+방향키를 누르면 줄 단위로 늘어난다.
    await page.keyboard.press("Shift+ArrowDown");
    expect((await state(page)).selection).toBe("A3:AX5");
    // 행 끝 열(AX)로 가로 스크롤하지 않는다.
    expect((await state(page)).visible).toMatch(/^A1:/);

    await clickCell(page, "B3");
    await clickCell(page, "C3", { shift: true });
    await page.keyboard.press("Control+Space");
    expect((await state(page)).selection).toBe("B1:C100000");

    await clickCell(page, "D2");
    await page.keyboard.press("Alt+Space");
    expect((await state(page)).selection).toBe("D1:D100000");
    expect((await state(page)).editing).toBeNull();
  });

  test("Shift+Space로 고른 행은 Ctrl+-로 지울 수 있다", async ({ page }) => {
    await clickCell(page, "C3");
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("ControlOrMeta+Minus");
    expect((await state(page)).rowCount).toBe(99_999);
  });
});

test.describe("오른쪽 클릭 메뉴", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const menu = (page: Page) => page.getByRole("menu", { name: "셀 메뉴" });
  const item = (page: Page, name: string) => menu(page).getByRole("menuitem", { name, exact: true });
  const choose = (page: Page, name: string) => item(page, name).click();
  const undo = (page: Page) => page.keyboard.press("ControlOrMeta+z");

  test("행 번호를 오른쪽 클릭해 위·아래에 행을 넣고, 각각 undo 한 번에 되돌린다", async ({ page }) => {
    const first = await cell(page, "A3");
    await clickHeader(page, 3, { button: "right" });
    expect((await state(page)).selection).toBe("A3:AX3");
    await expect(menu(page).getByRole("menuitem")).toHaveText([
      /^잘라내기/, /^복사/, /^붙여넣기/, /^위에 행 넣기/, /^아래에 행 넣기/, /^행 삭제/, /^내용 지우기/,
    ]);

    await choose(page, "위에 행 넣기");
    await expect(menu(page)).toBeHidden();
    expect((await state(page)).rowCount).toBe(100_001);
    expect(await cell(page, "A3")).toBe("");
    expect(await cell(page, "A4")).toBe(first);
    expect((await state(page)).selection).toBe("A3:AX3");
    await undo(page);
    expect((await state(page)).rowCount).toBe(100_000);
    expect(await cell(page, "A3")).toBe(first);

    await clickHeader(page, 3, { button: "right" });
    await choose(page, "아래에 행 넣기");
    expect(await cell(page, "A3")).toBe(first);
    expect(await cell(page, "A4")).toBe("");
    expect((await state(page)).selection).toBe("A3:AX3");
    await undo(page);
    expect((await state(page)).rowCount).toBe(100_000);
  });

  test("여러 줄을 고른 채 선택 안을 오른쪽 클릭하면 선택을 두고 고른 줄 수만큼 넣는다. 밖이면 그 줄로 옮긴다", async ({ page }) => {
    await clickHeader(page, 3);
    await clickHeader(page, 5, { shift: true });
    await clickHeader(page, 4, { button: "right" });
    expect((await state(page)).selection).toBe("A3:AX5");
    await expect(item(page, "위에 행 3개 넣기")).toBeVisible();
    await expect(item(page, "행 3개 삭제")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await clickHeader(page, 8, { button: "right" });
    expect((await state(page)).selection).toBe("A8:AX8");
    await choose(page, "행 삭제");
    expect((await state(page)).rowCount).toBe(99_999);
  });

  test("열 이름을 오른쪽 클릭해 오른쪽에 열을 넣으면 수식 범위가 따라간다", async ({ page }) => {
    await clickHeader(page, "E", { button: "right" });
    await choose(page, "오른쪽에 열 넣기");
    expect((await state(page)).colCount).toBe(51);
    expect((await state(page)).selection).toBe("E1:E100000");
    expect(await cell(page, "H2")).toBe("=SUM(D2:G2)");
    await undo(page);
    expect((await state(page)).colCount).toBe(50);
    expect(await cell(page, "G2")).toBe("=SUM(D2:F2)");
  });

  test("셀 범위를 오른쪽 클릭해 내용을 지우고, 걸친 행 전체를 지운다. 각각 undo 한 번이다", async ({ page }) => {
    const before = await Promise.all(["B3", "C4", "A5"].map((a1) => cell(page, a1)));
    await clickCell(page, "B3");
    await clickCell(page, "C4", { shift: true });

    await clickCell(page, "C3", { button: "right" });
    expect((await state(page)).selection).toBe("B3:C4");
    await choose(page, "내용 지우기");
    expect(await Promise.all(["B3", "C4"].map((a1) => cell(page, a1)))).toEqual(["", ""]);
    await undo(page);
    expect(await Promise.all(["B3", "C4"].map((a1) => cell(page, a1)))).toEqual(before.slice(0, 2));

    await clickCell(page, "B3", { button: "right" });
    await choose(page, "행 2개 삭제");
    expect((await state(page)).rowCount).toBe(99_998);
    expect(await cell(page, "A3")).toBe(before[2]);
    await undo(page);
    expect((await state(page)).rowCount).toBe(100_000);

    // 선택 밖을 오른쪽 클릭하면 그 셀로 옮긴다.
    await clickCell(page, "E7", { button: "right" });
    expect((await state(page)).selection).toBe("E7");
    await expect(item(page, "위에 행 넣기")).toBeVisible();
  });

  test("시트를 비우게 되는 삭제는 흐리게 보이고 고를 수 없다", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+a");
    await clickCell(page, "C3", { button: "right" });
    expect((await state(page)).selection).toBe("A1:AX100000");
    await expect(item(page, "행 100000개 삭제")).toHaveAttribute("aria-disabled", "true");
    await expect(item(page, "열 50개 삭제")).toHaveAttribute("aria-disabled", "true");
    // 흐린 항목은 Playwright가 누를 수 없다고 보고 기다리므로 강제로 누른다.
    await item(page, "행 100000개 삭제").click({ force: true });
    await expect(menu(page)).toBeVisible();
    expect((await state(page)).rowCount).toBe(100_000);
  });

  test("왼쪽 위 모서리를 오른쪽 클릭하면 시트 전체를 고르고 메뉴를 연다", async ({ page }) => {
    const box = (await grid(page).boundingBox())!;
    await page.mouse.click(box.x + HEADER_WIDTH / 2, box.y + HEADER_HEIGHT / 2, { button: "right" });
    expect((await state(page)).selection).toBe("A1:AX100000");
    await expect(menu(page)).toBeVisible();
  });

  test("Shift+F10으로 열고 ↑↓·Enter로 고른다. Esc로 닫으면 표에 다시 입력할 수 있다", async ({ page }) => {
    await clickCell(page, "B3");
    await page.keyboard.press("Shift+F10");
    await expect(menu(page)).toBeVisible();
    await expect(item(page, "잘라내기")).toHaveCSS("background-color", "rgb(232, 243, 236)");
    await expect(item(page, "잘라내기")).toHaveAttribute("aria-keyshortcuts", /X$/);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await page.keyboard.type("가나");
    await page.keyboard.press("Enter");
    expect(await cell(page, "B3")).toBe("가나");

    await clickCell(page, "B3");
    await page.keyboard.press("Shift+F10");
    // 잘라내기 → 복사 → 붙여넣기 → 내용 지우기 (구분선은 건너뛴다)
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeHidden();
    expect(await cell(page, "B3")).toBe("");
    await undo(page);
    expect(await cell(page, "B3")).toBe("가나");
  });

  test("바깥을 누르거나 스크롤하면 메뉴가 닫힌다", async ({ page }) => {
    await clickCell(page, "B3", { button: "right" });
    await expect(menu(page)).toBeVisible();
    // 메뉴가 덮지 않는 셀을 누른다. 메뉴는 닫히고 누른 셀이 선택된다.
    await clickCell(page, "H5");
    await expect(menu(page)).toBeHidden();
    expect((await state(page)).selection).toBe("H5");

    await clickCell(page, "B3", { button: "right" });
    await expect(menu(page)).toBeVisible();
    await page.mouse.wheel(0, 200);
    await expect(menu(page)).toBeHidden();
  });

  test("메뉴로 복사해 붙여넣으면 단축키와 같이 수식째 붙고, undo 한 번에 되돌린다", async ({ page }) => {
    const before = await cell(page, "H5");
    await clickCell(page, "G2");
    await clickCell(page, "G3", { shift: true });
    await clickCell(page, "G2", { button: "right" });
    await choose(page, "복사");
    expect((await state(page)).copied).toBe("G2:G3");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.split("\r\n")).toHaveLength(3);

    await clickCell(page, "H5", { button: "right" });
    await choose(page, "붙여넣기");
    await expect.poll(() => cell(page, "H5")).toBe("=SUM(E5:G5)");
    expect(await cell(page, "H6")).toBe("=SUM(E6:G6)");
    expect((await state(page)).selection).toBe("H5:H6");
    await undo(page);
    expect(await cell(page, "H5")).toBe(before);
  });

  test("메뉴로 잘라내 붙여넣으면 셀이 옮겨진다", async ({ page }) => {
    const value = await cell(page, "B2");
    await clickCell(page, "B2", { button: "right" });
    await choose(page, "잘라내기");
    await clickCell(page, "M2", { button: "right" });
    await choose(page, "붙여넣기");
    await expect.poll(() => cell(page, "M2")).toBe(value);
    expect(await cell(page, "B2")).toBe("");
  });

  test("브라우저가 클립보드 읽기를 막으면 아무것도 바꾸지 않고 단축키를 쓰라고 알린다", async ({ page }) => {
    await page.evaluate(() => {
      navigator.clipboard.readText = () => Promise.reject(new DOMException("막음", "NotAllowedError"));
    });
    const before = await cell(page, "B2");
    await clickCell(page, "B2", { button: "right" });
    await choose(page, "붙여넣기");
    await expect(page.getByRole("status")).toHaveText(/클립보드 읽기를 막았습니다\. (Ctrl\+V|⌘V)를 쓰세요\./);
    expect(await cell(page, "B2")).toBe(before);
  });
});

test.describe("열 너비·행 높이 조절", () => {
  const colWidth = (page: Page, column: string) => page.evaluate((column) => window.__excel!.colWidth(column), column);
  const rowHeight = (page: Page, row: number) => page.evaluate((row) => window.__excel!.rowHeight(row), row);
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);

  /** 스크롤하지 않은 표에서, 기본 크기 줄만 앞에 있을 때 열("B")의 오른쪽 경계선 또는 행(2)의 아래쪽 경계선 좌표 */
  async function border(page: Page, line: string | number) {
    const box = (await grid(page).boundingBox())!;
    return typeof line === "string"
      ? { x: box.x + HEADER_WIDTH + (line.charCodeAt(0) - 64) * COL_WIDTH, y: box.y + HEADER_HEIGHT / 2 }
      : { x: box.x + HEADER_WIDTH / 2, y: box.y + HEADER_HEIGHT + line * ROW_HEIGHT };
  }

  async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
    await page.mouse.up();
  }

  test("열 이름 사이 경계선을 끌면 그 열 너비가 바뀌고, 선택은 그대로이며, undo 한 번에 되돌린다", async ({ page }) => {
    const at = await border(page, "B");
    await page.mouse.move(at.x, at.y);
    expect(await grid(page).evaluate((el) => el.style.cursor)).toBe("col-resize");

    await drag(page, at, 36, 0);

    expect(await colWidth(page, "B")).toBe(COL_WIDTH + 36);
    expect(await colWidth(page, "C")).toBe(COL_WIDTH);
    expect((await state(page)).selection).toBe("A1");

    // 넓어진 만큼 오른쪽 열이 밀려서 그린다. 원래 C1 가운데를 누르면 이제 B1이다.
    await clickCell(page, "C1");
    await expect(nameBox(page)).toHaveValue("B1");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await colWidth(page, "B")).toBe(COL_WIDTH);
    await page.keyboard.press("ControlOrMeta+y");
    expect(await colWidth(page, "B")).toBe(COL_WIDTH + 36);
  });

  test("여러 열을 고른 채 그 안의 경계선을 끌면 고른 열이 모두 같은 너비가 된다", async ({ page }) => {
    await clickHeader(page, "B");
    await clickHeader(page, "D", { shift: true });

    await drag(page, await border(page, "C"), -24, 0);

    expect(await Promise.all(["B", "C", "D", "E"].map((column) => colWidth(page, column)))).toEqual([40, 40, 40, COL_WIDTH]);
    expect((await state(page)).selection).toBe("B1:D100000");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await Promise.all(["B", "C", "D"].map((column) => colWidth(page, column)))).toEqual([COL_WIDTH, COL_WIDTH, COL_WIDTH]);
  });

  test("행 번호 사이 경계선을 끌면 행 높이가 바뀌고, 경계선을 두 번 누르면 자동 높이로 돌아간다", async ({ page }) => {
    const at = await border(page, 2);
    await page.mouse.move(at.x, at.y);
    expect(await grid(page).evaluate((el) => el.style.cursor)).toBe("row-resize");

    await drag(page, at, 0, 25);
    expect(await rowHeight(page, 2)).toBe(ROW_HEIGHT + 25);
    expect(await rowHeight(page, 3)).toBe(ROW_HEIGHT);

    await page.mouse.dblclick(at.x, at.y + 25);
    expect(await rowHeight(page, 2)).toBe(ROW_HEIGHT);

    await page.keyboard.press("ControlOrMeta+z");
    expect(await rowHeight(page, 2)).toBe(ROW_HEIGHT + 25);
  });

  test("열 경계선을 두 번 누르면 가장 넓은 글자에 맞추고, 빈 열은 기본 너비로 돌린다", async ({ page }) => {
    await clickCell(page, "L5");
    await page.keyboard.type("열 너비를 넓히는 아주 긴 글자입니다");
    await page.keyboard.press("Enter");

    const at = await border(page, "L");
    await page.mouse.dblclick(at.x, at.y);
    const fitted = await colWidth(page, "L");
    expect(fitted).toBeGreaterThan(COL_WIDTH * 2);

    // 글자를 지우고 다시 맞추면 기본 너비가 된다. (넓어진 경계선 자리를 누른다)
    await clickCell(page, "L5");
    await page.keyboard.press("Delete");
    await page.mouse.dblclick(at.x - COL_WIDTH + fitted, at.y);
    expect(await colWidth(page, "L")).toBe(COL_WIDTH);
    expect(await cell(page, "L5")).toBe("");
  });

  test("열을 넣으면 바꾼 너비가 열과 함께 밀리고, 되돌리면 제자리로 온다", async ({ page }) => {
    await drag(page, await border(page, "B"), 36, 0);

    await clickHeader(page, "A");
    await page.keyboard.press("ControlOrMeta+Shift+Equal");

    expect(await Promise.all(["A", "B", "C"].map((column) => colWidth(page, column)))).toEqual([COL_WIDTH, COL_WIDTH, COL_WIDTH + 36]);
    await page.keyboard.press("ControlOrMeta+z");
    expect(await colWidth(page, "B")).toBe(COL_WIDTH + 36);
  });
});

test.describe("셀 안 줄바꿈", () => {
  const rowHeight = (page: Page, row: number) => page.evaluate((row) => window.__excel!.rowHeight(row), row);
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const editor = (page: Page) => page.getByLabel("셀 입력");
  // 1줄 20px, 줄이 늘 때마다 16px (LINE_HEIGHT)
  const linesHeight = (lines: number) => lines * 16 + 4;

  test("입력 중 Alt+Enter(Option+Enter)로 줄을 바꾸면 입력창이 커지고, 확정하면 행 높이가 저절로 맞춰진다", async ({ page }) => {
    await clickCell(page, "L3");
    await page.keyboard.type("첫 줄");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("둘째 줄");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("셋째");

    expect((await state(page)).editing).toBe("enter");
    expect((await editor(page).boundingBox())!.height).toBeGreaterThanOrEqual(linesHeight(3));

    await page.keyboard.press("Enter");
    expect(await cell(page, "L3")).toBe("첫 줄\n둘째 줄\n셋째");
    expect(await rowHeight(page, 3)).toBe(linesHeight(3));
    expect(await rowHeight(page, 4)).toBe(ROW_HEIGHT);
    await expect(nameBox(page)).toHaveValue("L4");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cell(page, "L3")).toBe("");
    expect(await rowHeight(page, 3)).toBe(ROW_HEIGHT);
  });

  test("F2로 여러 줄 셀을 고치면 줄을 지운 만큼 행 높이가 준다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.type("가");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("나");
    await page.keyboard.press("Enter");
    expect(await rowHeight(page, 2)).toBe(linesHeight(2));

    await clickCell(page, "L2");
    await page.keyboard.press("F2");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");

    expect(await cell(page, "L2")).toBe("가");
    expect(await rowHeight(page, 2)).toBe(ROW_HEIGHT);
  });

  test("높이를 직접 바꾼 행은 저절로 바뀌지 않고, 경계선을 두 번 누르면 다시 자동이 된다", async ({ page }) => {
    const box = (await grid(page).boundingBox())!;
    const border = { x: box.x + HEADER_WIDTH / 2, y: box.y + HEADER_HEIGHT + 3 * ROW_HEIGHT };
    await page.mouse.move(border.x, border.y);
    await page.mouse.down();
    await page.mouse.move(border.x, border.y + 10, { steps: 4 });
    await page.mouse.up();
    expect(await rowHeight(page, 3)).toBe(ROW_HEIGHT + 10);

    await clickCell(page, "L3");
    await page.keyboard.type("하나");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("둘");
    await page.keyboard.press("Alt+Enter");
    await page.keyboard.type("셋");
    await page.keyboard.press("Enter");
    expect(await rowHeight(page, 3)).toBe(ROW_HEIGHT + 10);

    await page.mouse.dblclick(border.x, border.y + 10);
    expect(await rowHeight(page, 3)).toBe(linesHeight(3));
  });
});

test.describe("채우기", () => {
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const cells = (page: Page, list: string[]) => Promise.all(list.map((a1) => cell(page, a1)));

  async function typeIn(page: Page, a1: string, text: string) {
    await clickCell(page, a1);
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }

  /** 스크롤하지 않은 표에서 셀("C5")의 오른쪽 아래 모서리 (그 셀로 끝나는 범위의 채우기 핸들) */
  async function cellCorner(page: Page, a1: string) {
    const center = await cellCenter(page, a1);
    return { x: center.x + COL_WIDTH / 2, y: center.y + ROW_HEIGHT / 2 };
  }

  /** 채우기 핸들(range 끝 셀의 모서리)을 to 셀 가운데까지 끈다. */
  async function dragFillHandle(page: Page, end: string, to: string) {
    const from = await cellCorner(page, end);
    const target = await cellCenter(page, to);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
  }

  test("숫자 두 칸을 골라 핸들을 아래로 끌면 같은 간격으로 이어 채우고, undo 한 번에 되돌린다", async ({ page }) => {
    await typeIn(page, "L2", "1");
    await typeIn(page, "L3", "3");
    await clickCell(page, "L2");
    await clickCell(page, "L3", { shift: true });

    await dragFillHandle(page, "L3", "L6");

    expect(await cells(page, ["L4", "L5", "L6"])).toEqual(["5", "7", "9"]);
    expect((await state(page)).selection).toBe("L2:L6");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cells(page, ["L4", "L5", "L6"])).toEqual(["", "", ""]);
  });

  test("핸들을 오른쪽으로 끌면 글자 끝 숫자와 요일이 이어진다", async ({ page }) => {
    await typeIn(page, "L2", "항목1");
    await typeIn(page, "L3", "금");
    await clickCell(page, "L2");
    await clickCell(page, "L3", { shift: true });

    await dragFillHandle(page, "L3", "O3");

    expect(await cells(page, ["M2", "N2", "O2"])).toEqual(["항목2", "항목3", "항목4"]);
    expect(await cells(page, ["M3", "N3", "O3"])).toEqual(["토", "일", "월"]);
    expect((await state(page)).selection).toBe("L2:O3");
  });

  test("수식을 핸들로 채우면 `$`가 없는 참조만 따라간다", async ({ page }) => {
    await typeIn(page, "L2", "=D2+$D$2");
    await clickCell(page, "L2");

    await dragFillHandle(page, "L2", "L4");

    expect(await cells(page, ["L3", "L4"])).toEqual(["=D3+$D$2", "=D4+$D$2"]);
  });

  test("핸들을 범위 안쪽으로 끌면 줄인 칸을 지운다", async ({ page }) => {
    for (const a1 of ["L2", "L3", "L4"]) await typeIn(page, a1, "값");
    await clickCell(page, "L2");
    await clickCell(page, "L4", { shift: true });

    await dragFillHandle(page, "L4", "L2");

    expect(await cells(page, ["L2", "L3", "L4"])).toEqual(["값", "", ""]);
    expect((await state(page)).selection).toBe("L2");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cells(page, ["L2", "L3", "L4"])).toEqual(["값", "값", "값"]);
  });

  test("끄는 중에 Esc를 누르면 아무것도 채우지 않는다", async ({ page }) => {
    await typeIn(page, "L2", "1");
    await clickCell(page, "L2");
    const from = await cellCorner(page, "L2");
    const target = await cellCenter(page, "L5");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();

    expect(await cells(page, ["L3", "L4", "L5"])).toEqual(["", "", ""]);
  });

  test("핸들을 두 번 누르면 옆 열에 값이 있는 곳까지 아래로 채운다", async ({ page }) => {
    for (const a1 of ["L2", "L3", "L4", "L5"]) await typeIn(page, a1, "x");
    await typeIn(page, "M2", "=D2+1");
    await clickCell(page, "M2");

    const corner = await cellCorner(page, "M2");
    await page.mouse.dblclick(corner.x, corner.y);

    expect(await cells(page, ["M3", "M4", "M5", "M6"])).toEqual(["=D3+1", "=D4+1", "=D5+1", ""]);
    expect((await state(page)).selection).toBe("M2:M5");
    expect((await state(page)).editing).toBeNull();
  });

  test("Ctrl+D는 첫 행을 아래 칸에 복사하고(수식은 참조가 따라감), undo 한 번에 되돌린다", async ({ page }) => {
    await typeIn(page, "L2", "항목1");
    await typeIn(page, "M2", "=D2*2");
    await clickCell(page, "L2");
    await clickCell(page, "M4", { shift: true });

    await page.keyboard.press("ControlOrMeta+d");

    expect(await cells(page, ["L3", "L4", "M3", "M4"])).toEqual(["항목1", "항목1", "=D3*2", "=D4*2"]);
    expect((await state(page)).selection).toBe("L2:M4");

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cells(page, ["L3", "L4", "M3", "M4"])).toEqual(["", "", "", ""]);
  });

  test("Ctrl+R은 한 열만 골랐으면 왼쪽 열을 복사해 온다", async ({ page }) => {
    await typeIn(page, "L2", "왼쪽");
    await clickCell(page, "M2");

    await page.keyboard.press("ControlOrMeta+r");

    expect(await cell(page, "M2")).toBe("왼쪽");
    // 브라우저 새로고침을 막았으므로 표가 그대로다.
    expect((await state(page)).active).toBe("M2");
  });

  test("범위를 고른 채 입력하고 Ctrl+Enter를 누르면 범위 전체에 넣고 선택은 그대로다", async ({ page }) => {
    await clickCell(page, "L2");
    await clickCell(page, "M3", { shift: true });
    await page.keyboard.type("=D2+1");

    await page.keyboard.press("ControlOrMeta+Enter");

    expect(await cells(page, ["L2", "M2", "L3", "M3"])).toEqual(["=D2+1", "=E2+1", "=D3+1", "=E3+1"]);
    const { selection, active, editing } = await state(page);
    expect({ selection, active, editing }).toEqual({ selection: "L2:M3", active: "L2", editing: null });

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cells(page, ["L2", "M2", "L3", "M3"])).toEqual(["", "", "", ""]);
  });
});

test.describe("툴바와 셀 서식", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  const toolbar = (page: Page) => page.getByRole("toolbar", { name: "서식 도구" });
  const button = (page: Page, name: string) => toolbar(page).getByRole("button", { name, exact: true });
  const format = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.format(a1), a1);
  const value = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.value(a1), a1);
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);
  const rowHeight = (page: Page, row: number) => page.evaluate((row) => window.__excel!.rowHeight(row), row);

  async function typeIn(page: Page, a1: string, text: string) {
    await clickCell(page, a1);
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }

  async function selectRange(page: Page, from: string, to: string) {
    await clickCell(page, from);
    await clickCell(page, to, { shift: true });
  }

  test("굵게 버튼을 누르면 고른 범위가 굵어지고 버튼이 눌린 모양이 되며, undo 한 번에 되돌아간다", async ({ page }) => {
    await selectRange(page, "L2", "M3");

    await button(page, "굵게").click();

    expect(await format(page, "L2")).toEqual({ bold: true });
    expect(await format(page, "M3")).toEqual({ bold: true });
    await expect(button(page, "굵게")).toHaveAttribute("aria-pressed", "true");

    // 다른 셀로 가면 그 셀의 서식이 버튼에 보인다.
    await clickCell(page, "N2");
    await expect(button(page, "굵게")).toHaveAttribute("aria-pressed", "false");

    await button(page, "실행 취소").click();
    expect(await format(page, "L2")).toEqual({});
    await expect(button(page, "다시 실행")).toBeEnabled();
    await button(page, "다시 실행").click();
    expect(await format(page, "M3")).toEqual({ bold: true });
  });

  test("Ctrl/Cmd+B·I·U로 켜고 끈다. 활성 셀이 켜져 있으면 고른 범위 모두 끈다", async ({ page }) => {
    await clickCell(page, "L2");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+i");
    await page.keyboard.press("ControlOrMeta+u");
    expect(await format(page, "L2")).toEqual({ bold: true, italic: true, underline: true });

    await clickCell(page, "M2", { shift: true });
    await page.keyboard.press("ControlOrMeta+b");

    expect(await format(page, "L2")).toEqual({ italic: true, underline: true });
    expect(await format(page, "M2")).toEqual({});
    expect((await state(page)).editing).toBeNull();
  });

  test("글자 크기·글자색·채우기 색을 고른 뒤 바로 표에 입력할 수 있다", async ({ page }) => {
    await typeIn(page, "L2", "큰 글자");
    await clickCell(page, "L2");

    await page.getByLabel("글자 크기").selectOption("20");
    await button(page, "글자색").click();
    await page.getByRole("dialog", { name: "글자색" }).getByRole("button", { name: "#ff0000" }).click();
    await button(page, "채우기 색").click();
    await page.getByRole("dialog", { name: "채우기 색" }).getByRole("button", { name: "#ffff00" }).click();

    expect(await format(page, "L2")).toEqual({ fontSize: 20, color: "#ff0000", fill: "#ffff00" });
    // 큰 글자에 맞춰 행이 높아진다.
    expect(await rowHeight(page, 2)).toBeGreaterThan(ROW_HEIGHT);

    // 포커스가 표로 돌아와 있어 바로 입력된다.
    await page.keyboard.type("다시");
    expect((await state(page)).editing).toBe("enter");
    await page.keyboard.press("Escape");

    await button(page, "채우기 색").click();
    await page.getByRole("dialog", { name: "채우기 색" }).getByRole("button", { name: "채우기 없음" }).click();
    expect(await format(page, "L2")).toEqual({ fontSize: 20, color: "#ff0000" });
  });

  test("숫자 형식: 숫자·통화·백분율을 고르고 소수 자릿수를 늘리고 줄인다", async ({ page }) => {
    await typeIn(page, "L2", "1234.5");
    await clickCell(page, "L2");
    const numberFormat = page.getByLabel("숫자 형식");

    await numberFormat.selectOption("number");
    expect(await value(page, "L2")).toBe("1,234.50");
    await button(page, "자릿수 줄임").click();
    expect(await value(page, "L2")).toBe("1,234.5");

    await numberFormat.selectOption("currency");
    expect(await value(page, "L2")).toBe("₩1,235");
    await button(page, "자릿수 늘림").click();
    expect(await value(page, "L2")).toBe("₩1,234.5");

    await numberFormat.selectOption("percent");
    expect(await value(page, "L2")).toBe("123450%");
    await expect(numberFormat).toHaveValue("percent");

    // 입력한 글자는 그대로다.
    expect(await cell(page, "L2")).toBe("1234.5");
  });

  test("테두리 메뉴에서 바깥쪽 테두리를 고르면 범위 바깥 변만 생기고, 테두리 없음으로 지운다", async ({ page }) => {
    await selectRange(page, "L2", "M3");

    await button(page, "테두리").click();
    await page.getByRole("menu", { name: "테두리" }).getByRole("menuitem", { name: "바깥쪽 테두리" }).click();

    expect(await format(page, "L2")).toEqual({ borderTop: true, borderLeft: true });
    expect(await format(page, "M3")).toEqual({ borderBottom: true, borderRight: true });

    await button(page, "테두리").click();
    await page.getByRole("menu", { name: "테두리" }).getByRole("menuitem", { name: "테두리 없음" }).click();
    expect(await format(page, "L2")).toEqual({});
  });

  test("정렬 버튼과 자동 줄바꿈: 줄바꿈을 켜면 열 너비에 맞춰 행이 높아지고, 끄면 돌아온다", async ({ page }) => {
    await typeIn(page, "L2", "가나다라 마바사아 자차카타 파하");
    await clickCell(page, "L2");

    await button(page, "가운데 맞춤").click();
    await button(page, "위쪽 맞춤").click();
    await expect(button(page, "가운데 맞춤")).toHaveAttribute("aria-pressed", "true");
    await expect(button(page, "아래쪽 맞춤")).toHaveAttribute("aria-pressed", "false");

    await button(page, "자동 줄바꿈").click();
    expect(await format(page, "L2")).toEqual({ align: "center", verticalAlign: "top", wrap: true });
    const wrapped = await rowHeight(page, 2);
    expect(wrapped).toBeGreaterThan(ROW_HEIGHT * 2);

    // 열을 넓히면 줄이 줄어 행도 낮아진다.
    const box = (await grid(page).boundingBox())!;
    const border = { x: box.x + HEADER_WIDTH + 12 * COL_WIDTH, y: box.y + HEADER_HEIGHT / 2 };
    await page.mouse.move(border.x, border.y);
    await page.mouse.down();
    await page.mouse.move(border.x + 200, border.y, { steps: 5 });
    await page.mouse.up();
    expect(await rowHeight(page, 2)).toBeLessThan(wrapped);

    await button(page, "자동 줄바꿈").click();
    expect(await rowHeight(page, 2)).toBe(ROW_HEIGHT);
  });

  test("서식 지우기는 서식만 지우고 값은 둔다", async ({ page }) => {
    await typeIn(page, "L2", "값");
    await clickCell(page, "L2");
    await page.keyboard.press("ControlOrMeta+b");
    await button(page, "가운데 맞춤").click();

    await button(page, "서식 지우기").click();

    expect(await format(page, "L2")).toEqual({});
    expect(await cell(page, "L2")).toBe("값");
  });

  test("10만 행 열 전체에 서식을 주면 마지막 행까지 바로 적용된다", async ({ page }) => {
    await clickHeader(page, "D");

    await button(page, "굵게").click();

    expect(await format(page, "D100000")).toEqual({ bold: true });
    expect(await format(page, "E100000")).toEqual({});
    await page.keyboard.press("ControlOrMeta+z");
    expect(await format(page, "D100000")).toEqual({});
  });

  test("앱 안에서 복사해 붙이면 서식이 따라가고, undo 한 번에 값과 서식이 함께 돌아간다", async ({ page }) => {
    await typeIn(page, "L2", "굵은 값");
    await clickCell(page, "L2");
    await page.keyboard.press("ControlOrMeta+b");

    await page.keyboard.press("ControlOrMeta+c");
    await clickCell(page, "N4");
    await page.keyboard.press("ControlOrMeta+v");

    expect(await cell(page, "N4")).toBe("굵은 값");
    expect(await format(page, "N4")).toEqual({ bold: true });

    await page.keyboard.press("ControlOrMeta+z");
    expect(await cell(page, "N4")).toBe("");
    expect(await format(page, "N4")).toEqual({});
  });

  test("채우기 핸들로 채우면 서식도 되풀이된다", async ({ page }) => {
    await typeIn(page, "L2", "1");
    await typeIn(page, "L3", "2");
    await clickCell(page, "L2");
    await page.keyboard.press("ControlOrMeta+b");
    await selectRange(page, "L2", "L3");

    const corner = await cellCenter(page, "L3");
    const target = await cellCenter(page, "L5");
    await page.mouse.move(corner.x + COL_WIDTH / 2, corner.y + ROW_HEIGHT / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();

    expect(await Promise.all(["L4", "L5"].map((a1) => cell(page, a1)))).toEqual(["3", "4"]);
    expect(await Promise.all(["L4", "L5"].map((a1) => format(page, a1)))).toEqual([{ bold: true }, {}]);
  });

  test("행을 넣으면 바로 위 행의 서식을 물려받는다", async ({ page }) => {
    await clickHeader(page, 3);
    await button(page, "굵게").click();
    await clickHeader(page, 4);

    await page.keyboard.press("ControlOrMeta+Shift+Equal");

    expect(await format(page, "L4")).toEqual({ bold: true });
    // 원래 4행은 5행으로 밀리고, 서식이 없던 행이라 그대로 기본이다.
    expect(await format(page, "L5")).toEqual({});
  });
});

test.describe("수식 입력줄과 이름 상자", () => {
  const formulaBar = (page: Page) => page.getByLabel("수식 입력줄");
  const editor = (page: Page) => page.getByLabel("셀 입력");
  const cell = (page: Page, a1: string) => page.evaluate((a1) => window.__excel!.cell(a1), a1);

  test("셀을 고르면 입력한 글자(수식이면 수식)가 수식 입력줄에 보인다", async ({ page }) => {
    await clickCell(page, "G2");
    await expect(formulaBar(page)).toHaveValue("=SUM(D2:F2)");

    await clickCell(page, "B2");
    await expect(formulaBar(page)).toHaveValue(await cell(page, "B2"));
  });

  test("수식 입력줄에서 치면 셀 입력창에도 같은 글자가 보이고, Enter로 확정하면 아래로 간다", async ({ page }) => {
    await clickCell(page, "L2");

    await formulaBar(page).click();
    await page.keyboard.type("=1+2");

    await expect(editor(page)).toHaveValue("=1+2");
    expect((await state(page)).editing).toBe("edit");

    await page.keyboard.press("Enter");

    expect(await cell(page, "L2")).toBe("=1+2");
    expect((await state(page)).active).toBe("L3");
    expect((await state(page)).editing).toBeNull();
    // 포커스가 표로 돌아와 바로 입력할 수 있다.
    await page.keyboard.type("x");
    await expect(editor(page)).toHaveValue("x");
  });

  test("셀에서 치면 수식 입력줄도 따라 바뀐다. 한글 조합 중인 글자도 보인다", async ({ page }) => {
    await clickCell(page, "L2");

    await page.keyboard.type("ab");
    await expect(formulaBar(page)).toHaveValue("ab");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
    await expect(formulaBar(page)).toHaveValue("ab한");
    await cdp.send("Input.insertText", { text: "한" });
    await cdp.detach();

    await page.keyboard.press("Enter");
    expect(await cell(page, "L2")).toBe("ab한");
  });

  test("수식 입력줄에서 Esc를 누르면 취소하고 원래 글자로 돌아간다", async ({ page }) => {
    await clickCell(page, "G2");

    await formulaBar(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type("*2");
    await expect(editor(page)).toHaveValue("=SUM(D2:F2)*2");
    await page.keyboard.press("Escape");

    expect(await cell(page, "G2")).toBe("=SUM(D2:F2)");
    await expect(formulaBar(page)).toHaveValue("=SUM(D2:F2)");
    expect((await state(page)).editing).toBeNull();
  });

  test("이름 상자에 주소를 치고 Enter를 누르면 그 셀·범위로 가고, 틀린 주소면 그대로 머문다", async ({ page }) => {
    await nameBox(page).click();
    await page.keyboard.type("c500");
    await page.keyboard.press("Enter");

    expect((await state(page)).active).toBe("C500");
    expect((await state(page)).visible).toMatch(/500/);
    await expect(nameBox(page)).toHaveValue("C500");

    await nameBox(page).click();
    await page.keyboard.type("B2:D4");
    await page.keyboard.press("Enter");
    expect((await state(page)).selection).toBe("B2:D4");

    await nameBox(page).click();
    await page.keyboard.type("없는주소");
    await page.keyboard.press("Enter");
    await expect(nameBox(page)).toHaveAttribute("aria-invalid", "true");
    expect((await state(page)).selection).toBe("B2:D4");

    await page.keyboard.press("Escape");
    await expect(nameBox(page)).toHaveValue("B2");
  });
});
