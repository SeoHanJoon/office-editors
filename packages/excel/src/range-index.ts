import type { CellRange } from "./address";

interface Node {
  readonly range: CellRange;
  /** 이 범위를 가진 수식 셀 키 */
  readonly owner: number;
  /** 같은 top끼리 순서를 정하는 번호. 넣을 때마다 늘어난다. */
  readonly id: number;
  /** 트립 우선순위. 부모가 자식보다 크다. */
  readonly priority: number;
  /** 이 노드 아래(자신 포함) 범위 중 가장 큰 bottom. 이보다 아래 행은 이 서브트리에 없다. */
  maxBottom: number;
  left: Node | null;
  right: Node | null;
}

/**
 * 범위 수식 색인 (구간 트리). "이 셀을 범위로 참조하는 수식"을 모든 범위를 훑지 않고 찾는다.
 *
 * 범위를 행 구간 [top, bottom]으로 보고, top 순서로 정렬한 이진 트리에 넣는다.
 * 노드마다 자기 아래 가장 큰 bottom(maxBottom)을 적어 두어, 찾는 행에 닿을 수 없는 가지는 통째로 건너뛴다.
 * 열은 행으로 찾은 뒤 하나씩 확인한다.
 *
 * 트리는 트립(treap)으로 균형을 맞춘다. 노드마다 무작위 우선순위를 붙여 부모가 자식보다 크도록 돌리면
 * 넣는 순서와 상관없이 높이가 평균 log(범위 수)가 된다. 우선순위는 고정 시드로 만들어 매번 같은 트리가 나온다.
 * 찾는 시간은 평균 log(범위 수) + 찾은 수 정도다.
 */
export class RangeIndex {
  private root: Node | null = null;
  private readonly nodesByOwner = new Map<number, Node[]>();
  private nextId = 0;
  private seed = 0x9e3779b9;

  /** owner 수식이 참조하는 범위들을 넣는다. 이미 있으면 먼저 remove한다. */
  add(owner: number, ranges: readonly CellRange[]): void {
    this.remove(owner);
    if (ranges.length === 0) return;
    const nodes: Node[] = [];
    for (const range of ranges) {
      const node: Node = {
        range,
        owner,
        id: this.nextId++,
        priority: this.random(),
        maxBottom: range.bottom,
        left: null,
        right: null,
      };
      this.root = insert(this.root, node);
      nodes.push(node);
    }
    this.nodesByOwner.set(owner, nodes);
  }

  /** owner 수식의 범위를 모두 뺀다. */
  remove(owner: number): void {
    const nodes = this.nodesByOwner.get(owner);
    if (!nodes) return;
    this.nodesByOwner.delete(owner);
    for (const node of nodes) this.root = remove(this.root, node);
  }

  /**
   * (row, col) 셀을 포함하는 범위마다 그 owner로 visit을 부른다.
   * 한 수식이 이 셀을 포함하는 범위를 여러 개 가지면 여러 번 부른다.
   */
  forEachContaining(row: number, col: number, visit: (owner: number) => void): void {
    const stack: (Node | null)[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || node.maxBottom < row) continue;
      stack.push(node.left);
      // 오른쪽 가지는 top이 이 노드보다 크거나 같다. 이 노드가 벌써 row 아래에서 시작하면 오른쪽도 모두 그렇다.
      if (node.range.top > row) continue;
      const { bottom, left, right } = node.range;
      if (row <= bottom && col >= left && col <= right) visit(node.owner);
      stack.push(node.right);
    }
  }

  /** 0 이상 1 미만의 의사 난수 (xorshift32) */
  private random(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0x1_0000_0000;
  }
}

/** a가 b보다 트리에서 앞(왼쪽)인지. top이 같으면 먼저 넣은 쪽이 앞이다. */
function before(a: Node, b: Node): boolean {
  return a.range.top < b.range.top || (a.range.top === b.range.top && a.id < b.id);
}

function update(node: Node): void {
  let max = node.range.bottom;
  if (node.left && node.left.maxBottom > max) max = node.left.maxBottom;
  if (node.right && node.right.maxBottom > max) max = node.right.maxBottom;
  node.maxBottom = max;
}

/** 왼쪽 자식을 위로 올린다. */
function rotateRight(node: Node): Node {
  const top = node.left!;
  node.left = top.right;
  top.right = node;
  update(node);
  update(top);
  return top;
}

/** 오른쪽 자식을 위로 올린다. */
function rotateLeft(node: Node): Node {
  const top = node.right!;
  node.right = top.left;
  top.left = node;
  update(node);
  update(top);
  return top;
}

/** 트리 높이가 평균 log(n)이라 재귀가 깊어지지 않는다. */
function insert(root: Node | null, node: Node): Node {
  if (!root) return node;
  if (before(node, root)) {
    root.left = insert(root.left, node);
    if (root.left.priority > root.priority) return rotateRight(root);
  } else {
    root.right = insert(root.right, node);
    if (root.right.priority > root.priority) return rotateLeft(root);
  }
  update(root);
  return root;
}

function remove(root: Node | null, node: Node): Node | null {
  if (!root) return null;
  if (root === node) return merge(root.left, root.right);
  if (before(node, root)) root.left = remove(root.left, node);
  else root.right = remove(root.right, node);
  update(root);
  return root;
}

/** 왼쪽 트리의 모든 노드가 오른쪽 트리보다 앞일 때 두 트리를 하나로 합친다. */
function merge(left: Node | null, right: Node | null): Node | null {
  if (!left) return right;
  if (!right) return left;
  if (left.priority > right.priority) {
    left.right = merge(left.right, right);
    update(left);
    return left;
  }
  right.left = merge(left, right.left);
  update(right);
  return right;
}
