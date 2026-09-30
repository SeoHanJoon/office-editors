import type { ContextMenuEntry, ContextMenuItem } from "@office/ui";
import type { CellRange } from "./address";
import type { SheetBounds } from "./selection";
import { canChangeStructure, type StructureChange } from "./structure";

/** 오른쪽 클릭한 곳: 행 머리글, 열 머리글, 셀(왼쪽 위 모서리 포함) */
export type GridMenuTarget = "row" | "col" | "cell";

/** 메뉴에서 고른 동작 */
export type GridMenuCommand =
  | { readonly type: "cut" | "copy" | "paste" | "clear" }
  | { readonly type: "structure"; readonly change: StructureChange };

type Shortcut = "cut" | "copy" | "paste" | "clear" | "insert" | "delete";

const SHORTCUTS: Record<Shortcut, readonly [mac: string, other: string]> = {
  cut: ["⌘X", "Ctrl+X"],
  copy: ["⌘C", "Ctrl+C"],
  paste: ["⌘V", "Ctrl+V"],
  clear: ["⌦", "Delete"],
  insert: ["⇧⌘=", "Ctrl+Shift+="],
  delete: ["⌘-", "Ctrl+-"],
};

/**
 * 오른쪽 클릭 메뉴 항목. (README "Step 7 범위", ADR 0029)
 * range는 메뉴를 열 때의 선택 범위다. 행·열 넣기/지우기는 range가 걸친 줄 전체에 하고, 고른 줄 수만큼 넣는다.
 * 시트를 비우게 되는 지우기와 최대 크기를 넘는 넣기는 흐리게 한다.
 * 단축키는 그 키가 이 메뉴 항목과 같은 일을 할 때만 보여준다. (셀 범위를 고른 채 Ctrl+Shift+=는 아무것도 하지 않는다. ADR 0026)
 */
export function gridMenu(
  target: GridMenuTarget,
  range: CellRange,
  bounds: SheetBounds,
  { mac }: { mac: boolean },
): ContextMenuEntry<GridMenuCommand>[] {
  const shortcut = (name: Shortcut) => SHORTCUTS[name][mac ? 0 : 1];
  const item = (label: string, type: "cut" | "copy" | "paste" | "clear"): ContextMenuItem<GridMenuCommand> => ({
    label,
    shortcut: shortcut(type),
    value: { type },
  });
  const rows = range.bottom - range.top + 1;
  const cols = range.right - range.left + 1;
  const structure = (label: string, change: StructureChange, key?: "insert" | "delete"): ContextMenuItem<GridMenuCommand> => ({
    label,
    ...(key && { shortcut: shortcut(key) }),
    disabled: !canChangeStructure(change, bounds),
    value: { type: "structure", change },
  });
  const count = (n: number) => (n > 1 ? ` ${n}개` : "");

  const insertAbove = (key?: "insert") =>
    structure(`위에 행${count(rows)} 넣기`, { kind: "insert", axis: "row", index: range.top, count: rows }, key);
  const insertBelow = () =>
    structure(`아래에 행${count(rows)} 넣기`, { kind: "insert", axis: "row", index: range.bottom + 1, count: rows });
  const insertLeft = (key?: "insert") =>
    structure(`왼쪽에 열${count(cols)} 넣기`, { kind: "insert", axis: "col", index: range.left, count: cols }, key);
  const insertRight = () =>
    structure(`오른쪽에 열${count(cols)} 넣기`, { kind: "insert", axis: "col", index: range.right + 1, count: cols });
  const deleteRows = (key?: "delete") =>
    structure(`행${count(rows)} 삭제`, { kind: "delete", axis: "row", index: range.top, count: rows }, key);
  const deleteCols = (key?: "delete") =>
    structure(`열${count(cols)} 삭제`, { kind: "delete", axis: "col", index: range.left, count: cols }, key);

  const clipboard = [item("잘라내기", "cut"), item("복사", "copy"), item("붙여넣기", "paste")];
  const clear = item("내용 지우기", "clear");

  switch (target) {
    case "row":
      return [...clipboard, "separator", insertAbove("insert"), insertBelow(), "separator", deleteRows("delete"), "separator", clear];
    case "col":
      return [...clipboard, "separator", insertLeft("insert"), insertRight(), "separator", deleteCols("delete"), "separator", clear];
    case "cell":
      return [
        ...clipboard,
        "separator",
        clear,
        "separator",
        insertAbove(),
        insertBelow(),
        insertLeft(),
        insertRight(),
        "separator",
        deleteRows(),
        deleteCols(),
      ];
  }
}
