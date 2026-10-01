/**
 * 한 축(행 또는 열)의 줄 크기와 위치. (ADR 0032)
 *
 * 기본 크기와 다른 줄만 번호 순서로 담고, 그 앞까지 쌓인 "기본 크기와의 차이"를 함께 둔다.
 * 줄 위치와 위치 → 줄은 이진 탐색 한 번이라 log(다른 줄 수) 시간이다. 바뀐 줄이 없으면 곱셈·나눗셈과 같다.
 * 만든 뒤에는 바뀌지 않는다. 크기가 바뀌면 새로 만든다.
 */
export class LineSizes {
  /** 줄 수 */
  readonly count: number;
  readonly defaultSize: number;
  /** 기본 크기와 다른 줄 번호. 오름차순 */
  private readonly lines: number[] = [];
  /** lines[i] 줄의 크기 */
  private readonly sizes: number[] = [];
  /** before[i] = lines[0..i)의 (크기 - 기본 크기) 합. 길이는 lines.length + 1 */
  private readonly before: number[] = [0];

  /** custom: [줄 번호, 크기] 목록. 순서는 상관없다. 줄 수 밖의 줄과 기본 크기와 같은 줄은 무시한다. */
  constructor(count: number, defaultSize: number, custom: Iterable<readonly [number, number]> = []) {
    if (!(defaultSize > 0)) throw new RangeError(`기본 크기는 0보다 커야 한다: ${defaultSize}`);
    this.count = count;
    this.defaultSize = defaultSize;
    const entries: [number, number][] = [];
    for (const [line, size] of custom) {
      if (!(size > 0)) throw new RangeError(`줄 크기는 0보다 커야 한다: ${line}번 줄 ${size}`);
      if (line >= 0 && line < count && size !== defaultSize) entries.push([line, size]);
    }
    entries.sort((a, b) => a[0] - b[0]);
    let sum = 0;
    for (const [line, size] of entries) {
      this.lines.push(line);
      this.sizes.push(size);
      sum += size - defaultSize;
      this.before.push(sum);
    }
  }

  /** 줄 하나의 크기 */
  size(line: number): number {
    const i = this.countBefore(line);
    return this.lines[i] === line ? this.sizes[i]! : this.defaultSize;
  }

  /** 줄이 시작하는 위치. 첫 줄은 0이고, offset(count)는 모든 줄 크기의 합이다. */
  offset(line: number): number {
    return line * this.defaultSize + this.before[this.countBefore(line)]!;
  }

  /** 모든 줄 크기의 합 */
  get total(): number {
    return this.offset(this.count);
  }

  /** 위치가 들어 있는 줄. 줄 경계는 뒤 줄에 속한다. 범위 밖이면 첫 줄이나 마지막 줄로 잘라 넣는다. */
  lineAt(position: number): number {
    const { lines, sizes, before, defaultSize } = this;
    // 시작 위치가 position 이하인 다른 줄 중 마지막 것을 찾는다. (시작 위치는 줄 번호 순서대로 커진다)
    let low = 0;
    let high = lines.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (lines[mid]! * defaultSize + before[mid]! <= position) low = mid + 1;
      else high = mid;
    }
    let line: number;
    if (low === 0) {
      line = Math.floor(position / defaultSize);
    } else {
      const i = low - 1;
      const end = lines[i]! * defaultSize + before[i]! + sizes[i]!;
      // 그 줄 안이면 그 줄, 지나쳤으면 뒤따르는 기본 크기 줄들 중 하나다.
      line = position < end ? lines[i]! : lines[i]! + 1 + Math.floor((position - end) / defaultSize);
    }
    return Math.min(Math.max(line, 0), this.count - 1);
  }

  /** 기본 크기와 다른 줄을 [줄 번호, 크기]로 번호 순서대로 훑는다. */
  *custom(): IterableIterator<[number, number]> {
    for (let i = 0; i < this.lines.length; i++) yield [this.lines[i]!, this.sizes[i]!];
  }

  /** line보다 앞에 있는 다른 줄 수 (lines에서 line 이상인 첫 자리) */
  private countBefore(line: number): number {
    const { lines } = this;
    let low = 0;
    let high = lines.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (lines[mid]! < line) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
