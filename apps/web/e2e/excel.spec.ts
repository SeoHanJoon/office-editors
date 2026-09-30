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

test("1,000행 표를 휠로 끝까지 내리고 마지막 행을 클릭하면 선택된다", async ({ page }) => {
  const box = (await grid(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await expect(async () => {
    await page.mouse.wheel(0, 5000);
    expect((await state(page)).visible).toMatch(/:[A-Z]+1000$/);
  }).toPass();

  // 끝까지 스크롤하면 마지막 행이 화면 아래쪽(가로 스크롤바 위)에 딱 붙는다.
  const clientHeight = await grid(page).evaluate((el) => el.clientHeight);
  await page.mouse.click(box.x + HEADER_WIDTH + COL_WIDTH * 1.5, box.y + clientHeight - ROW_HEIGHT / 2);

  await expect(nameBox(page)).toHaveValue("B1000");
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
  await expect(nameBox(page)).toHaveValue("A1000");
  expect((await state(page)).visible).toMatch(/1000$/);

  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await expect(nameBox(page)).toHaveValue("D1000");

  await page.keyboard.press("Home");
  await expect(nameBox(page)).toHaveValue("A1000");

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
