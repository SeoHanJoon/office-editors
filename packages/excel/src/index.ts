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
export { FormulaEngine, type FormulaChangeListener, type FormulaEngineOptions } from "./formula-engine";
export { FormulaError, formatValue, type CellValue, type ErrorCode } from "./formula-value";
export { GridView, type GridViewOptions } from "./grid-view";
export { DEFAULT_LAYOUT, type GridLayout } from "./layout";
export { selectCell, selectRange, selectionRange, type Selection } from "./selection";
export { SetCellsCommand } from "./set-cells-command";
export { SetCustomSizesCommand } from "./set-custom-sizes-command";
export {
  Sheet,
  type Axis,
  type CellChange,
  type CustomSizeChange,
  type CustomSizeListener,
  type SheetChangeListener,
  type SheetOptions,
  type StructureChangeListener,
  type StructureResult,
} from "./sheet";
export type { StructureChange } from "./structure";
export { StructureCommand } from "./structure-command";
