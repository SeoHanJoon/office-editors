import { formatValue, type CellValue } from "./formula-value";

/** 가로 정렬. 없으면 값 종류에 따른다. (숫자는 오른쪽, 글자는 왼쪽, 논리값·에러는 가운데) */
export type HorizontalAlign = "left" | "center" | "right";

/** 세로 정렬. 없으면 아래 (Excel 기본) */
export type VerticalAlign = "top" | "middle" | "bottom";

/** 숫자 형식 종류. "number"는 천 단위 쉼표, "currency"는 ₩와 쉼표, "percent"는 100을 곱하고 %를 붙인다. */
export type NumberFormatKind = "general" | "number" | "currency" | "percent";

/** 숫자 형식. "general"은 decimals를 쓰지 않는다. (ADR 0034) */
export type NumberFormat =
  | { readonly kind: "general" }
  | { readonly kind: "number" | "currency" | "percent"; readonly decimals: number };

/**
 * 셀 서식. 기본값과 다른 항목만 담는다. (빈 객체가 기본 서식)
 * Sheet가 같은 서식을 한 번만 두고 나눠 쓰므로(서식 표, ADR 0034) 받은 객체를 고치면 안 된다.
 */
export interface CellFormat {
  readonly bold?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly strike?: true;
  /** 글자 크기 (pt). 없으면 DEFAULT_FONT_SIZE */
  readonly fontSize?: number;
  /** 글자색 ("#rrggbb"). 없으면 검정 */
  readonly color?: string;
  /** 채우기 색 ("#rrggbb"). 없으면 채우지 않는다. */
  readonly fill?: string;
  /** 테두리. 가는 검정 실선 한 종류다. */
  readonly borderTop?: true;
  readonly borderRight?: true;
  readonly borderBottom?: true;
  readonly borderLeft?: true;
  readonly align?: HorizontalAlign;
  readonly verticalAlign?: VerticalAlign;
  /** 자동 줄바꿈. 열 너비에 맞춰 줄을 바꾸고 행 높이에 반영한다. (ADR 0036) */
  readonly wrap?: true;
  /** 없으면 일반 */
  readonly numberFormat?: Exclude<NumberFormat, { kind: "general" }>;
}

/**
 * 서식을 바꿀 항목. 값을 주면 그 값으로, null(또는 false)이면 기본값으로 돌린다. 없는 항목은 그대로 둔다.
 * 숫자 형식을 { kind: "general" }로 주면 일반으로 돌린다.
 */
export type FormatPatch = {
  readonly [K in Exclude<keyof CellFormat, "numberFormat">]?: (CellFormat[K] extends true | undefined ? boolean : CellFormat[K]) | null;
} & { readonly numberFormat?: NumberFormat | null };

/** 기본 서식. 서식 표의 0번이다. */
export const DEFAULT_FORMAT: CellFormat = Object.freeze({});

/** 기본 글자 크기 (pt). 셀 글꼴 13⅓px와 같다. */
export const DEFAULT_FONT_SIZE = 10;

/** 서식 항목 이름. 서식을 글자 키로 만들 때 이 순서로 쓴다. */
const KEYS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "fontSize",
  "color",
  "fill",
  "borderTop",
  "borderRight",
  "borderBottom",
  "borderLeft",
  "align",
  "verticalAlign",
  "wrap",
  "numberFormat",
] as const satisfies readonly (keyof CellFormat)[];

/** 모든 항목을 기본값으로 돌리는 patch. (서식 지우기) */
export const CLEAR_FORMAT: FormatPatch = Object.freeze(Object.fromEntries(KEYS.map((key) => [key, null])) as FormatPatch);

/** 숫자 형식의 소수 자릿수 한도 (Excel과 같음) */
export const MAX_DECIMALS = 30;

/**
 * base에 patch를 적용한 서식. base는 바꾸지 않는다.
 * 기본값과 같은 항목(false, 기본 글자 크기, 일반 숫자 형식)은 담지 않는다.
 */
export function mergeFormat(base: CellFormat, patch: FormatPatch): CellFormat {
  const next: Record<string, unknown> = { ...base };
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null || value === undefined || value === false || isDefault(key, value)) delete next[key];
    else next[key] = value;
  }
  return next as CellFormat;
}

function isDefault(key: (typeof KEYS)[number], value: unknown): boolean {
  if (key === "fontSize") return value === DEFAULT_FONT_SIZE;
  if (key === "numberFormat") return (value as NumberFormat).kind === "general";
  return false;
}

/** 서식 표에서 같은 서식을 찾는 글자 키. 항목 순서와 상관없이 같은 서식이면 같다. */
export function formatKey(format: CellFormat): string {
  const parts: string[] = [];
  for (const key of KEYS) {
    const value = format[key];
    if (value === undefined) continue;
    parts.push(typeof value === "object" ? `${key}=${value.kind}:${value.decimals}` : `${key}=${String(value)}`);
  }
  return parts.join(";");
}

/** 글자 크기(pt)를 CSS px로 바꾼다. */
export function fontPx(size: number): number {
  return (size * 4) / 3;
}

/** 글자 크기(pt)에 맞는 줄 높이 (px). 기본 크기면 16px다. */
export function lineHeightFor(size: number): number {
  return Math.round(fontPx(size) * 1.2);
}

/** Canvas·CSS의 font 값. family는 글꼴 이름들 */
export function fontFor(format: CellFormat, family: string): string {
  const style = format.italic ? "italic " : "";
  const weight = format.bold ? "bold " : "";
  return `${style}${weight}${fontPx(format.fontSize ?? DEFAULT_FONT_SIZE)}px ${family}`;
}

/** 형식 종류를 고를 때 쓰는 처음 소수 자릿수. (Excel의 쉼표 스타일 2자리, ₩·% 0자리) */
export function numberFormatOf(kind: NumberFormatKind): NumberFormat {
  if (kind === "general") return { kind };
  return { kind, decimals: kind === "number" ? 2 : 0 };
}

/**
 * 소수 자릿수를 delta만큼 늘리거나 줄인 형식. (0 아래, MAX_DECIMALS 위로는 가지 않는다)
 * 일반 형식이면 지금 보이는 숫자(shown)의 소수 자릿수에서 시작해 "숫자" 형식이 된다.
 * Excel은 일반에서 늘리면 쉼표 없는 "0.00" 형식이 되지만, 여기에는 쉼표 없는 형식이 없다. (ADR 0034)
 */
export function changeDecimals(format: NumberFormat, delta: number, shown: string): NumberFormat {
  const current = format.kind === "general" ? shownDecimals(shown) : format.decimals;
  const kind = format.kind === "general" ? "number" : format.kind;
  return { kind, decimals: Math.min(Math.max(current + delta, 0), MAX_DECIMALS) };
}

/** 보이는 숫자 글자의 소수 자릿수. ("1.25" → 2, "1E-05" → 0) */
function shownDecimals(shown: string): number {
  const match = /\.(\d+)/.exec(shown);
  return match && !/e/i.test(shown) ? match[1]!.length : 0;
}

/**
 * 숫자를 형식에 맞게 쓴다. 일반 형식은 부르는 쪽이 formatNumber로 쓴다.
 * 반올림은 Excel처럼 10진수 기준으로 0에서 먼 쪽이다. (1.005 → "1.01")
 */
export function formatWithNumberFormat(value: number, format: Exclude<NumberFormat, { kind: "general" }>): string {
  const scaled = format.kind === "percent" ? value * 100 : value;
  const rounded = roundDecimal(Math.abs(scaled), format.decimals);
  // toFixed는 1e21 이상이면 지수 모양을 돌려준다. 그런 수는 일반 형식처럼 쓴다.
  if (rounded >= 1e21) return `${scaled < 0 ? "-" : ""}${String(rounded).replace("e+", "E+")}`;
  const [integer, fraction] = rounded.toFixed(format.decimals).split(".");
  const grouped = format.kind === "percent" ? integer! : integer!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  // 반올림해서 0이 된 음수는 -를 붙이지 않는다. (Excel과 같음)
  const sign = scaled < 0 && rounded !== 0 ? "-" : "";
  if (format.kind === "currency") return `${sign}₩${body}`;
  if (format.kind === "percent") return `${sign}${body}%`;
  return `${sign}${body}`;
}

/** 0 이상의 수를 소수 decimals자리로 반올림한다. 10진수 글자로 자리를 옮겨 2진수 오차(1.005 → 1.00)를 피한다. */
function roundDecimal(value: number, decimals: number): number {
  const text = String(Number(value.toPrecision(15)));
  // 아주 크거나 작은 수는 글자가 지수 모양("1e-7")이라 자리를 옮길 수 없다. 2진수 오차가 문제 되지 않는 크기다.
  if (text.includes("e")) return Math.round(value * 10 ** decimals) / 10 ** decimals;
  const shifted = Math.round(Number(`${text}e${decimals}`));
  return Number(`${shifted}e-${decimals}`);
}

/** 계산값을 셀에 보이는 글자로 바꾼다. 숫자는 숫자 형식을 따르고, 나머지는 formatValue와 같다. */
export function formatCellValue(value: CellValue, format: CellFormat): string {
  if (typeof value === "number" && format.numberFormat) return formatWithNumberFormat(value, format.numberFormat);
  return formatValue(value);
}
