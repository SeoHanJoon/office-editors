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
export { GridView, type GridViewOptions } from "./grid-view";
export { DEFAULT_LAYOUT, type GridLayout } from "./layout";
export { selectCell, selectionRange, type Selection } from "./selection";
export { Sheet, type SheetOptions } from "./sheet";
