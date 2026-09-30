import { expect, test } from "@playwright/test";

test("첫 페이지를 열면 제목과 연결된 패키지가 보인다", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Office Editors");
  await expect(page.getByRole("heading", { name: "Office Editors" })).toBeVisible();
  await expect(page.getByRole("list", { name: "연결된 패키지" }).getByRole("listitem")).toHaveText([
    "@office/command-core",
    "@office/ui",
    "@office/excel",
    "@office/docs",
    "@office/ppt",
  ]);
});
