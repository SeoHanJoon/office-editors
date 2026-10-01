import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";

/**
 * 에디터 위에 놓는 툴바 부품. 에디터(Excel, Docs, PPT)를 모르고 버튼·고르기·색 고르기만 그린다. (ADR 0035)
 * 버튼은 눌러도 포커스를 가져가지 않는다. 에디터가 키보드 포커스(셀 입력창 등)를 계속 갖게 하기 위해서다.
 */

const COLORS = {
  border: "#d0d0d0",
  hover: "#ebebeb",
  pressed: "#d3f0e0",
  pressedBorder: "#107c41",
  text: "#222222",
  disabled: "#a0a0a0",
  popover: "#ffffff",
};

/** 누르는 순간 포커스가 버튼으로 옮겨 가지 않게 한다. */
function keepFocus(event: MouseEvent): void {
  event.preventDefault();
}

export interface ToolbarProps {
  /** 접근성 이름 (aria-label) */
  label: string;
  children: ReactNode;
}

/** 버튼들을 한 줄로 놓는 틀 */
export function Toolbar({ label, children }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, padding: "4px 8px", borderBottom: `1px solid ${COLORS.border}` }}
    >
      {children}
    </div>
  );
}

/** 버튼 묶음 사이의 세로선 */
export function ToolbarSeparator() {
  return <div role="separator" aria-orientation="vertical" style={{ width: 1, height: 20, margin: "0 4px", background: COLORS.border }} />;
}

export interface ToolbarButtonProps {
  /** 접근성 이름. 마우스를 올리면 보이는 설명(title)도 된다. (단축키가 있으면 title에 따로 준다) */
  label: string;
  title?: string;
  /** 켜고 끄는 버튼이면 지금 켜져 있는지. 안 주면 그냥 누르는 버튼이다. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function buttonStyle(pressed: boolean, disabled: boolean, hover: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minWidth: 28,
    height: 28,
    padding: "0 4px",
    border: `1px solid ${pressed ? COLORS.pressedBorder : "transparent"}`,
    borderRadius: 4,
    background: pressed ? COLORS.pressed : hover && !disabled ? COLORS.hover : "transparent",
    color: disabled ? COLORS.disabled : COLORS.text,
    cursor: disabled ? "default" : "pointer",
    font: "inherit",
  };
}

/** 아이콘 버튼. pressed를 주면 켜고 끄는 버튼(aria-pressed)이 된다. */
export function ToolbarButton({ label, title, pressed, disabled = false, onClick, children }: ToolbarButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={keepFocus}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={buttonStyle(pressed === true, disabled, hover)}
    >
      {children}
    </button>
  );
}

export interface ToolbarSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
  width?: number;
}

/** 목록에서 하나 고르기 (글자 크기, 숫자 형식 등). 고르는 동안은 포커스를 가져간다. */
export function ToolbarSelect<T extends string>({ label, value, options, onChange, width = 72 }: ToolbarSelectProps<T>) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      style={{ width, height: 28, border: `1px solid ${COLORS.border}`, borderRadius: 4, background: COLORS.popover, color: COLORS.text, font: "inherit" }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** 버튼을 누르면 아래에 펼쳐지는 판. 바깥을 누르거나 Esc를 누르면 닫힌다. */
function usePopover(): { open: boolean; setOpen: (open: boolean) => void; ref: RefObject<HTMLDivElement | null> } {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const popoverStyle: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  zIndex: 20,
  marginTop: 2,
  padding: 6,
  background: COLORS.popover,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
};

export interface ToolbarMenuProps<T extends string> {
  label: string;
  items: readonly { readonly value: T; readonly label: string; readonly icon?: ReactNode }[];
  onSelect: (value: T) => void;
  /** 버튼에 보이는 아이콘 */
  children: ReactNode;
}

/** 누르면 항목 목록이 펼쳐지는 버튼 (테두리 모양 등). 항목을 고르면 닫힌다. */
export function ToolbarMenu<T extends string>({ label, items, onSelect, children }: ToolbarMenuProps<T>) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <ToolbarButton label={label} onClick={() => setOpen(!open)}>
        {children}
        <span aria-hidden style={{ fontSize: 9 }}>
          ▼
        </span>
      </ToolbarButton>
      {open && (
        <div role="menu" aria-label={label} style={{ ...popoverStyle, minWidth: 160 }}>
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              onMouseDown={keepFocus}
              onClick={() => {
                setOpen(false);
                onSelect(item.value);
              }}
              style={{ ...buttonStyle(false, false, false), width: "100%", justifyContent: "flex-start", gap: 8 }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ColorPickerProps {
  label: string;
  /** 지금 색 ("#rrggbb"). 기본(자동·없음)이면 null */
  value: string | null;
  colors: readonly string[];
  /** 기본으로 돌리는 항목의 이름 ("자동", "채우기 없음") */
  noneLabel: string;
  onChange: (color: string | null) => void;
  /** 버튼에 보이는 아이콘. 아래에 지금 색 띠가 붙는다. */
  children: ReactNode;
}

/** 색 고르기 버튼. 누르면 색 칸 판이 펼쳐진다. */
export function ColorPicker({ label, value, colors, noneLabel, onChange, children }: ColorPickerProps) {
  const { open, setOpen, ref } = usePopover();
  const choose = (color: string | null) => {
    setOpen(false);
    onChange(color);
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <ToolbarButton label={label} onClick={() => setOpen(!open)}>
        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
          {children}
          <span aria-hidden style={{ width: 16, height: 3, background: value ?? "transparent", border: value ? "none" : `1px solid ${COLORS.border}` }} />
        </span>
        <span aria-hidden style={{ fontSize: 9 }}>
          ▼
        </span>
      </ToolbarButton>
      {open && (
        <div role="dialog" aria-label={label} style={popoverStyle}>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => choose(null)}
            style={{ ...buttonStyle(value === null, false, false), width: "100%", marginBottom: 4 }}
          >
            {noneLabel}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 20px)", gap: 4 }}>
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                title={color}
                aria-pressed={value === color}
                onMouseDown={keepFocus}
                onClick={() => choose(color)}
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  background: color,
                  border: value === color ? `2px solid ${COLORS.pressedBorder}` : `1px solid ${COLORS.border}`,
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
