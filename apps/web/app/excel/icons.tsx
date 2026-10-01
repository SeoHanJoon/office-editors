import type { CSSProperties, ReactNode } from "react";

/** 툴바 아이콘. 16×16, 선 색은 글자색을 따른다. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      {children}
    </svg>
  );
}

/** 글자 하나로 된 아이콘 (굵게 B, 기울임 I 등) */
export function LetterIcon({ letter, style }: { letter: string; style?: CSSProperties }) {
  return (
    <span aria-hidden style={{ display: "inline-block", width: 16, textAlign: "center", fontSize: 14, lineHeight: "16px", ...style }}>
      {letter}
    </span>
  );
}

export const UndoIcon = () => (
  <Icon>
    <path d="M5 4 2 7l3 3" />
    <path d="M2 7h8a4 4 0 0 1 0 8H7" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="m11 4 3 3-3 3" />
    <path d="M14 7H6a4 4 0 0 0 0 8h3" />
  </Icon>
);

export const FillIcon = () => (
  <Icon>
    <path d="m3 8 5-5 5 5-5 5z" />
    <path d="M13.5 10.5c.8 1 .8 2 0 2.5" />
  </Icon>
);

export const BorderAllIcon = () => (
  <Icon>
    <rect x={2} y={2} width={12} height={12} />
    <path d="M8 2v12M2 8h12" />
  </Icon>
);

export const BorderOuterIcon = () => (
  <Icon>
    <rect x={2} y={2} width={12} height={12} />
    <path d="M8 4v8M4 8h8" strokeDasharray="1 2" />
  </Icon>
);

export const BorderNoneIcon = () => (
  <Icon>
    <path d="M2 2h12v12H2zM8 2v12M2 8h12" strokeDasharray="1 2" />
  </Icon>
);

/** 한 변만 굵게 그린 테두리 아이콘 */
export function BorderSideIcon({ side }: { side: "top" | "bottom" | "left" | "right" }) {
  const line = { top: "M2 2h12", bottom: "M2 14h12", left: "M2 2v12", right: "M14 2v12" }[side];
  return (
    <Icon>
      <path d="M2 2h12v12H2z" strokeDasharray="1 2" />
      <path d={line} strokeWidth={2} />
    </Icon>
  );
}

/** 가로 정렬: 글자 줄 네 개를 왼쪽·가운데·오른쪽에 맞춘다. */
export function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const lines = [12, 8, 12, 8].map((width, i) => {
    const x = align === "left" ? 2 : align === "right" ? 14 - width : 8 - width / 2;
    return <path key={i} d={`M${x} ${3 + i * 3.3}h${width}`} />;
  });
  return <Icon>{lines}</Icon>;
}

/** 세로 정렬: 칸 안의 글자 줄 두 개를 위·가운데·아래에 맞춘다. */
export function VerticalAlignIcon({ align }: { align: "top" | "middle" | "bottom" }) {
  const y = align === "top" ? 4 : align === "middle" ? 7 : 10;
  return (
    <Icon>
      <path d={align === "top" ? "M2 2h12" : align === "bottom" ? "M2 14h12" : "M2 8h1M13 8h1"} />
      <path d={`M5 ${y}h6M5 ${y + 2.5}h6`} />
    </Icon>
  );
}

export const WrapIcon = () => (
  <Icon>
    <path d="M2 3h12M2 7h10a2 2 0 0 1 0 4H8" />
    <path d="m9.5 9.5-1.5 1.5 1.5 1.5" />
    <path d="M2 11h3M2 14h12" />
  </Icon>
);

export const ClearFormatIcon = () => (
  <Icon>
    <path d="m6 13 7-7-3-3-7 7 3 3z" />
    <path d="M6 13h8M5 6l4 4" />
  </Icon>
);
