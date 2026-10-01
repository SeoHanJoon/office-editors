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
export {
  CLEAR_FORMAT,
  DEFAULT_FONT_SIZE,
  DEFAULT_FORMAT,
  changeDecimals,
  formatCellValue,
  numberFormatOf,
  type CellFormat,
  type FormatPatch,
  type HorizontalAlign,
  type NumberFormat,
  type NumberFormatKind,
  type VerticalAlign,
} from "./cell-format";
export type { EditMode } from "./edit-keys";
export { type BorderKind } from "./format-edit";
export { FormulaEngine, type FormulaChangeListener, type FormulaEngineOptions } from "./formula-engine";
export { FormulaError, formatValue, type CellValue, type ErrorCode } from "./formula-value";
export { GridView, type EditState, type FormatToggle, type GridViewOptions } from "./grid-view";
export { DEFAULT_LAYOUT, type GridLayout } from "./layout";
export { selectCell, selectRange, selectionRange, type Selection } from "./selection";
export { SetCellsCommand } from "./set-cells-command";
export { SetCustomSizesCommand } from "./set-custom-sizes-command";
export { SetFormatsCommand } from "./set-formats-command";
export {
  Sheet,
  type Axis,
  type CellChange,
  type CellFormatChange,
  type CustomSizeChange,
  type FormatChangeListener,
  type FormatChanges,
  type LineFormatChange,
  type CustomSizeListener,
  type SheetChangeListener,
  type SheetOptions,
  type StructureChangeListener,
  type StructureResult,
} from "./sheet";
export type { StructureChange } from "./structure";
export { StructureCommand } from "./structure-command";
