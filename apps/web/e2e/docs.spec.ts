import { expect, test, type Page } from "@playwright/test";

const documentArea = (page: Page) => page.getByRole("textbox", { name: "문서" });
const button = (page: Page, name: string) => page.getByRole("toolbar", { name: "서식 도구" }).getByRole("button", { name, exact: true });
const html = (page: Page) => page.evaluate(() => window.__docs!.html());

/**
 * 한글 입력기처럼 자모를 조합하며 글자를 입력한다. (Chrome의 실제 조합 이벤트: compositionstart → update → end)
 * syllables는 글자마다 조합 단계를 적는다. 예: [["ㅎ", "하", "한"], ["ㄱ", "그", "글"]]
 */
async function typeKorean(page: Page, syllables: string[][]) {
  const cdp = await page.context().newCDPSession(page);
  for (const steps of syllables) {
    for (const text of steps) {
      await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
      // CDP 호출에는 녹화용 slowMo가 걸리지 않아서, 녹화할 때만 조합 단계가 영상에 보이도록 쉰다.
      if (process.env.RECORD === "1") await page.waitForTimeout(300);
    }
    await cdp.send("Input.insertText", { text: steps.at(-1)! });
  }
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/docs");
  await page.waitForFunction(() => window.__docs !== undefined);
  await expect(documentArea(page)).toBeFocused();
});

test("첫 페이지의 Docs 링크로 들어갈 수 있다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Docs" }).click();

  await expect(page).toHaveTitle("Docs · Office Editors");
  await expect(documentArea(page)).toBeVisible();
});

test("글을 쓰고 Enter로 문단을 나눈다", async ({ page }) => {
  await page.keyboard.type("Hello world");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");

  await expect(documentArea(page).locator("p")).toHaveText(["Hello world", "Second line"]);
});

test("한글을 조합해서 입력해도 글자가 사라지거나 두 번 들어가지 않는다", async ({ page }) => {
  await typeKorean(page, [["ㅎ", "하", "한"], ["ㄱ", "그", "글"]]);
  await page.keyboard.type(" ");
  await typeKorean(page, [["ㅁ", "무", "문"], ["ㅅ", "서"]]);

  await expect(documentArea(page).locator("p")).toHaveText(["한글 문서"]);

  // undo는 단어 단위로 되돌린다.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(documentArea(page).locator("p")).toHaveText(["한글 "]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(documentArea(page).locator("p")).toHaveText([""]);
});

test.describe("서식", () => {
  test("툴바 버튼으로 굵게·기울임을 켜고 치면 그 서식으로 들어가고, 버튼이 눌린 모양이 된다", async ({ page }) => {
    await page.keyboard.type("plain ");
    await button(page, "굵게").click();
    await expect(button(page, "굵게")).toHaveAttribute("aria-pressed", "true");
    // 버튼을 눌러도 포커스는 문서에 남는다.
    await expect(documentArea(page)).toBeFocused();
    await page.keyboard.type("bold");
    await button(page, "굵게").click();
    await page.keyboard.press("ControlOrMeta+i");
    await page.keyboard.type(" italic");

    expect(await html(page)).toBe("<p>plain <strong>bold</strong><em> italic</em></p>");
    await expect(button(page, "기울임꼴")).toHaveAttribute("aria-pressed", "true");
    await expect(button(page, "굵게")).toHaveAttribute("aria-pressed", "false");
  });

  test("고른 글자에 밑줄·취소선을 준다", async ({ page }) => {
    await page.keyboard.type("one two");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");
    await button(page, "밑줄").click();
    await button(page, "취소선").click();

    expect(await html(page)).toBe("<p>one <s><u>two</u></s></p>");
  });

  test("문단 모양을 제목으로 바꾸고, 목록과 인용을 켠다", async ({ page }) => {
    await page.keyboard.type("Title");
    await page.getByLabel("문단 모양").selectOption("heading1");
    await expect(page.getByLabel("문단 모양")).toHaveValue("heading1");
    await expect(documentArea(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await button(page, "글머리 기호 목록").click();
    await page.keyboard.type("apple");
    await page.keyboard.press("Enter");
    await page.keyboard.type("banana");
    await expect(button(page, "글머리 기호 목록")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    await button(page, "인용").click();
    await page.keyboard.type("quote");

    // 문서 끝이 문단이 아니면 Tiptap이 빈 문단을 덧붙인다. (그 아래로 커서를 옮길 수 있게)
    expect(await html(page)).toBe(
      "<h1>Title</h1><ul><li><p>apple</p></li><li><p>banana</p></li></ul><blockquote><p>quote</p></blockquote><p></p>",
    );
  });
});

test.describe("실행 취소·다시 실행", () => {
  test("단축키로 단어·서식을 하나씩 되돌리고 다시 실행한다", async ({ page }) => {
    await expect(button(page, "실행 취소")).toBeDisabled();
    await page.keyboard.type("Hello world");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+b");
    expect(await html(page)).toBe("<p><strong>Hello world</strong></p>");

    // 서식 → "world" → "Hello " 순서로 되돌린다.
    await page.keyboard.press("ControlOrMeta+z");
    expect(await html(page)).toBe("<p>Hello world</p>");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await html(page)).toBe("<p>Hello </p>");
    await page.keyboard.press("ControlOrMeta+z");
    expect(await html(page)).toBe("<p></p>");
    await expect(button(page, "실행 취소")).toBeDisabled();

    await page.keyboard.press("ControlOrMeta+y");
    expect(await html(page)).toBe("<p>Hello </p>");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect(await html(page)).toBe("<p>Hello world</p>");
  });

  test("툴바 버튼으로 되돌리고 다시 실행한다. 문단 모양도 따라 돌아간다", async ({ page }) => {
    await page.keyboard.type("Title");
    await page.getByLabel("문단 모양").selectOption("heading2");
    // 끝에 덧붙은 빈 문단도 제목 바꾸기와 함께 한 번에 되돌아가야 한다.
    expect(await html(page)).toBe("<h2>Title</h2><p></p>");

    await button(page, "실행 취소").click();
    expect(await html(page)).toBe("<p>Title</p>");
    await expect(page.getByLabel("문단 모양")).toHaveValue("paragraph");
    await expect(documentArea(page)).toBeFocused();

    await button(page, "다시 실행").click();
    expect(await html(page)).toBe("<h2>Title</h2><p></p>");
    await expect(button(page, "다시 실행")).toBeDisabled();
  });
});
