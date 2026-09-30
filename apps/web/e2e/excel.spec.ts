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

async function clickCell(page: Page, a1: string, { shift = false } = {}) {
  const { x, y } = await cellCenter(page, a1);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(x, y);
  if (shift) await page.keyboard.up("Shift");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/excel");
  await page.waitForFunction(() => window.__excel !== undefined);
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
