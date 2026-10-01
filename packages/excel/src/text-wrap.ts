/**
 * 자동 줄바꿈 셀의 글자를 width(px) 안에 들어가게 줄로 나눈다. (ADR 0036)
 * - 줄바꿈 문자에서 먼저 나눈다.
 * - 한 줄이 넘치면 마지막 공백에서 나눈다. 공백은 줄 끝에 남기지 않는다.
 * - 공백 없이 한 낱말이 넘치면 글자 단위로 나눈다. 한 글자도 안 들어가면 한 글자씩 둔다.
 * measure는 글자 너비(px)를 잰다.
 */
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) wrapParagraph(paragraph, width, measure, lines);
  return lines;
}

function wrapParagraph(paragraph: string, width: number, measure: (text: string) => number, lines: string[]): void {
  if (measure(paragraph) <= width) {
    lines.push(paragraph);
    return;
  }
  // 낱말과 그 뒤 공백을 한 조각으로 본다. ("ab  cd" → "ab  ", "cd")
  const pieces = paragraph.match(/\S+\s*|\s+/g) ?? [];
  let line = "";
  for (const piece of pieces) {
    const candidate = line + piece;
    if (measure(candidate.trimEnd()) <= width) {
      line = candidate;
      continue;
    }
    if (line !== "") {
      lines.push(line.trimEnd());
      line = "";
    }
    if (measure(piece.trimEnd()) <= width) {
      line = piece;
      continue;
    }
    // 낱말 하나가 너무 길면 글자 단위로 나눈다.
    for (const char of piece.trimEnd()) {
      if (line !== "" && measure(line + char) > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  lines.push(line.trimEnd());
}
