export const packageName = "@office/excel";

export {
  MAX_COLS,
  MAX_ROWS,
  columnName,
  parseA1,
  rangeToA1,
  toA1,
  type CellAddress,
  type CellRange,
} from "./address";
export type { EditMode } from "./edit-keys";
export { GridView, type GridViewOptions } from "./grid-view";
export { DEFAULT_LAYOUT, type GridLayout } from "./layout";
export { selectCell, selectRange, selectionRange, type Selection } from "./selection";
export { SetCellsCommand } from "./set-cells-command";
export { Sheet, type CellChange, type SheetChangeListener, type SheetOptions } from "./sheet";
