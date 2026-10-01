import type { ReactNode } from "react";

/** Docs 툴바 아이콘. 16×16, 선 색은 글자색을 따른다. (실행 취소·글자 아이콘은 Excel 것을 함께 쓴다) */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      {children}
    </svg>
  );
}

export const BulletListIcon = () => (
  <Icon>
    <circle cx={3} cy={4} r={0.8} fill="currentColor" />
    <circle cx={3} cy={8} r={0.8} fill="currentColor" />
    <circle cx={3} cy={12} r={0.8} fill="currentColor" />
    <path d="M6 4h8M6 8h8M6 12h8" />
  </Icon>
);

export const OrderedListIcon = () => (
  <Icon>
    <path d="M2 2.5h1v3M2 5.5h2" strokeWidth={1} />
    <path d="M2 9.5h1.5l-1.5 2h2" strokeWidth={1} />
    <path d="M6 4h8M6 8h8M6 12h8" />
  </Icon>
);

export const BlockquoteIcon = () => (
  <Icon>
    <path d="M3 3v10" strokeWidth={2} />
    <path d="M6 5h8M6 8h8M6 11h5" />
  </Icon>
);
