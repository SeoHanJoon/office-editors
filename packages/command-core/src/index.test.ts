import { expect, test } from "vitest";
import { packageName } from "./index";

test("패키지 이름을 내보낸다", () => {
  expect(packageName).toBe("@office/command-core");
});
