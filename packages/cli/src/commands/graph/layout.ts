export interface GraphNode {
	readonly name: string;
	readonly relDir: string;
	readonly hasBuildScript: boolean;
}

export type EdgeKind = "runtime" | "dev";

export interface GraphEdge {
	readonly from: string;
	readonly to: string;
	readonly kind: EdgeKind;
}

export interface RenderInput {
	readonly nodes: ReadonlyArray<GraphNode>;
	readonly edges: ReadonlyArray<GraphEdge>;
	readonly target: string | undefined;
	readonly width: number;
	readonly withDev: boolean;
	readonly reduce?: boolean;
}

export interface CycleInput {
	readonly nodes: ReadonlyArray<GraphNode>;
	readonly edges: ReadonlyArray<GraphEdge>;
	readonly withDev?: boolean;
}

const GUTTER = 3;
const BUILD_TOKEN = "build";
const BOX_ROWS = 4;
const MIN_ROUTE_ROWS = 3;
const DUMMY_WIDTH = 3;

const _activeEdges = (
	edges: ReadonlyArray<GraphEdge>,
	withDev: boolean,
): GraphEdge[] => (withDev ? edges.slice() : edges.filter((e) => e.kind === "runtime"));

const _adjacency = (edges: ReadonlyArray<GraphEdge>): Map<string, string[]> => {
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		const list = adj.get(e.from) ?? [];
		list.push(e.to);
		adj.set(e.from, list);
	}
	return adj;
};

const _reverseAdjacency = (edges: ReadonlyArray<GraphEdge>): Map<string, string[]> => {
	const rev = new Map<string, string[]>();
	for (const e of edges) {
		const list = rev.get(e.to) ?? [];
		list.push(e.from);
		rev.set(e.to, list);
	}
	return rev;
};

export const detectCycle = (input: CycleInput): ReadonlyArray<string> | null => {
	const edges = _activeEdges(input.edges, input.withDev ?? true);
	const adj = _adjacency(edges);
	const colour = new Map<string, "white" | "grey" | "black">();
	for (const n of input.nodes) colour.set(n.name, "white");
	const path: string[] = [];
	const visit = (node: string): ReadonlyArray<string> | null => {
		colour.set(node, "grey");
		path.push(node);
		const children = adj.get(node) ?? [];
		for (const c of children) {
			const colC = colour.get(c) ?? "white";
			if (colC === "grey") {
				const startIdx = path.indexOf(c);
				return [...path.slice(startIdx), c];
			}
			if (colC === "white") {
				const cyc = visit(c);
				if (cyc) return cyc;
			}
		}
		path.pop();
		colour.set(node, "black");
		return null;
	};
	for (const n of input.nodes) {
		if (colour.get(n.name) === "white") {
			const cyc = visit(n.name);
			if (cyc) return cyc;
		}
	}
	return null;
};

const _reachableFromTarget = (
	nodes: ReadonlyArray<GraphNode>,
	edges: ReadonlyArray<GraphEdge>,
	target: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } => {
	const adj = _adjacency(edges);
	const reach = new Set<string>([target]);
	const queue: string[] = [target];
	while (queue.length > 0) {
		const cur = queue.shift() ?? "";
		const kids = adj.get(cur) ?? [];
		for (const k of kids) {
			if (!reach.has(k)) {
				reach.add(k);
				queue.push(k);
			}
		}
	}
	return {
		nodes: nodes.filter((n) => reach.has(n.name)),
		edges: edges.filter((e) => reach.has(e.from) && reach.has(e.to)),
	};
};

const _transitiveReduce = (
	nodes: ReadonlyArray<GraphNode>,
	edges: ReadonlyArray<GraphEdge>,
): GraphEdge[] => {
	const adj = _adjacency(edges);
	const reachableExcl = (start: string, skipDirect: string): Set<string> => {
		const seen = new Set<string>();
		const queue: string[] = [];
		const firstKids = adj.get(start) ?? [];
		for (const k of firstKids) {
			if (k !== skipDirect && !seen.has(k)) {
				seen.add(k);
				queue.push(k);
			}
		}
		while (queue.length > 0) {
			const cur = queue.shift() ?? "";
			const kids = adj.get(cur) ?? [];
			for (const k of kids) {
				if (!seen.has(k)) {
					seen.add(k);
					queue.push(k);
				}
			}
		}
		return seen;
	};
	void nodes;
	return edges.filter((e) => {
		const otherReachable = reachableExcl(e.from, e.to);
		return !otherReachable.has(e.to);
	});
};

const _computeRanks = (
	nodes: ReadonlyArray<GraphNode>,
	edges: ReadonlyArray<GraphEdge>,
	target: string | undefined,
): Map<string, number> => {
	const rev = _reverseAdjacency(edges);
	const ranks = new Map<string, number>();
	if (target !== undefined) {
		ranks.set(target, 0);
	} else {
		for (const n of nodes) {
			const hasIncoming = (rev.get(n.name)?.length ?? 0) > 0;
			if (!hasIncoming) ranks.set(n.name, 0);
		}
	}
	let changed = true;
	let iterations = 0;
	const maxIterations = nodes.length * nodes.length + 1;
	while (changed && iterations < maxIterations) {
		changed = false;
		iterations++;
		for (const e of edges) {
			const fromRank = ranks.get(e.from);
			if (fromRank === undefined) continue;
			const candidate = fromRank + 1;
			const cur = ranks.get(e.to);
			if (cur === undefined || cur < candidate) {
				ranks.set(e.to, candidate);
				changed = true;
			}
		}
	}
	for (const n of nodes) {
		if (!ranks.has(n.name)) ranks.set(n.name, 0);
	}
	return ranks;
};

interface LayoutNodeData {
	readonly name: string;
	readonly real: GraphNode | null;
	readonly rank: number;
}

interface LayoutEdgeData {
	readonly from: string;
	readonly to: string;
	readonly kind: EdgeKind;
	readonly isFinal: boolean;
}

const _insertDummies = (
	nodes: ReadonlyArray<GraphNode>,
	edges: ReadonlyArray<GraphEdge>,
	ranks: Map<string, number>,
): { layoutNodes: LayoutNodeData[]; layoutEdges: LayoutEdgeData[] } => {
	const layoutNodes: LayoutNodeData[] = nodes.map((n) => ({
		name: n.name,
		real: n,
		rank: ranks.get(n.name) ?? 0,
	}));
	const layoutEdges: LayoutEdgeData[] = [];
	let dummyCounter = 0;
	for (const e of edges) {
		const fromRank = ranks.get(e.from) ?? 0;
		const toRank = ranks.get(e.to) ?? 0;
		const gap = toRank - fromRank;
		if (gap <= 1) {
			layoutEdges.push({ from: e.from, to: e.to, kind: e.kind, isFinal: true });
			continue;
		}
		let prev = e.from;
		for (let r = fromRank + 1; r < toRank; r++) {
			const dName = `__dummy_${dummyCounter++}`;
			layoutNodes.push({ name: dName, real: null, rank: r });
			layoutEdges.push({ from: prev, to: dName, kind: e.kind, isFinal: false });
			prev = dName;
		}
		layoutEdges.push({ from: prev, to: e.to, kind: e.kind, isFinal: true });
	}
	return { layoutNodes, layoutEdges };
};

const _groupLayers = (layoutNodes: ReadonlyArray<LayoutNodeData>): LayoutNodeData[][] => {
	const maxRank = Math.max(0, ...layoutNodes.map((n) => n.rank));
	const layers: LayoutNodeData[][] = Array.from({ length: maxRank + 1 }, () => []);
	for (const n of layoutNodes) {
		layers[n.rank]?.push(n);
	}
	for (const layer of layers) {
		layer.sort((a, b) => {
			if (a.real === null && b.real !== null) return 1;
			if (a.real !== null && b.real === null) return -1;
			return a.name.localeCompare(b.name);
		});
	}
	return layers;
};

const _median = (xs: ReadonlyArray<number>): number => {
	if (xs.length === 0) return Number.POSITIVE_INFINITY;
	const sorted = xs.slice().sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
	const left = sorted[mid - 1] ?? 0;
	const right = sorted[mid] ?? 0;
	return (left + right) / 2;
};

const _countCrossings = (
	upper: ReadonlyArray<LayoutNodeData>,
	lower: ReadonlyArray<LayoutNodeData>,
	edges: ReadonlyArray<LayoutEdgeData>,
): number => {
	const upperPos = new Map<string, number>();
	upper.forEach((n, i) => upperPos.set(n.name, i));
	const lowerPos = new Map<string, number>();
	lower.forEach((n, i) => lowerPos.set(n.name, i));
	const boundaryEdges = edges.filter((e) => upperPos.has(e.from) && lowerPos.has(e.to));
	let crossings = 0;
	for (let i = 0; i < boundaryEdges.length; i++) {
		for (let j = i + 1; j < boundaryEdges.length; j++) {
			const ei = boundaryEdges[i];
			const ej = boundaryEdges[j];
			if (!ei || !ej) continue;
			const ui = upperPos.get(ei.from) ?? 0;
			const uj = upperPos.get(ej.from) ?? 0;
			const li = lowerPos.get(ei.to) ?? 0;
			const lj = lowerPos.get(ej.to) ?? 0;
			if ((ui < uj && li > lj) || (ui > uj && li < lj)) crossings++;
		}
	}
	return crossings;
};

const _barycenterReorder = (
	layers: LayoutNodeData[][],
	edges: ReadonlyArray<LayoutEdgeData>,
): LayoutNodeData[][] => {
	let best = layers.map((l) => l.slice());
	let next = layers.map((l) => l.slice());
	const adj = new Map<string, string[]>();
	const rev = new Map<string, string[]>();
	for (const e of edges) {
		const a = adj.get(e.from) ?? [];
		a.push(e.to);
		adj.set(e.from, a);
		const r = rev.get(e.to) ?? [];
		r.push(e.from);
		rev.set(e.to, r);
	}
	const bestCrossings = (cfg: LayoutNodeData[][]): number => {
		let total = 0;
		for (let li = 0; li < cfg.length - 1; li++) {
			total += _countCrossings(cfg[li] ?? [], cfg[li + 1] ?? [], edges);
		}
		return total;
	};
	let bestCount = bestCrossings(best);
	for (let pass = 0; pass < 12; pass++) {
		const downward = pass % 2 === 0;
		if (downward) {
			for (let li = 1; li < next.length; li++) {
				const parentLayer = next[li - 1] ?? [];
				const parentPos = new Map<string, number>();
				parentLayer.forEach((n, i) => parentPos.set(n.name, i));
				const layer = next[li] ?? [];
				const score = (n: LayoutNodeData): number => {
					const parents = rev.get(n.name) ?? [];
					const ps = parents
						.map((p) => parentPos.get(p))
						.filter((v): v is number => v !== undefined);
					return _median(ps);
				};
				layer.sort((a, b) => {
					const sa = score(a);
					const sb = score(b);
					if (sa === sb) return a.name.localeCompare(b.name);
					return sa - sb;
				});
			}
		} else {
			for (let li = next.length - 2; li >= 0; li--) {
				const childLayer = next[li + 1] ?? [];
				const childPos = new Map<string, number>();
				childLayer.forEach((n, i) => childPos.set(n.name, i));
				const layer = next[li] ?? [];
				const score = (n: LayoutNodeData): number => {
					const children = adj.get(n.name) ?? [];
					const cs = children
						.map((c) => childPos.get(c))
						.filter((v): v is number => v !== undefined);
					return _median(cs);
				};
				layer.sort((a, b) => {
					const sa = score(a);
					const sb = score(b);
					if (sa === sb) return a.name.localeCompare(b.name);
					return sa - sb;
				});
			}
		}
		const cnt = bestCrossings(next);
		if (cnt < bestCount) {
			bestCount = cnt;
			best = next.map((l) => l.slice());
		}
	}
	return best;
};

const _outgoingCount = (
	name: string,
	edges: ReadonlyArray<LayoutEdgeData>,
): number => edges.filter((e) => e.from === name).length;

const _incomingCount = (
	name: string,
	edges: ReadonlyArray<LayoutEdgeData>,
): number => edges.filter((e) => e.to === name).length;

const _boxWidth = (n: LayoutNodeData, edges: ReadonlyArray<LayoutEdgeData>): number => {
	if (n.real === null) return DUMMY_WIDTH;
	const node = n.real;
	const buildSeg = node.hasBuildScript ? BUILD_TOKEN.length + 1 : 0;
	const nameRowWidth = node.name.length + 4;
	const midWidth = node.relDir.length + buildSeg + 4;
	const outCount = _outgoingCount(n.name, edges);
	const inCount = _incomingCount(n.name, edges);
	const outSpace = 2 * outCount + 1;
	const inSpace = 2 * inCount + 1;
	return Math.max(nameRowWidth, midWidth, outSpace, inSpace, 5);
};

interface LaidNode {
	readonly data: LayoutNodeData;
	readonly boxStartX: number;
	readonly boxWidth: number;
	readonly layerIndex: number;
}

const _layoutLayers = (
	layers: LayoutNodeData[][],
	edges: ReadonlyArray<LayoutEdgeData>,
): { canvas: LaidNode[][]; canvasWidth: number; widthOk: boolean; rawWidths: number[] } => {
	const widthsPerLayer: number[] = layers.map((l) =>
		l.reduce((acc, n, i) => acc + _boxWidth(n, edges) + (i > 0 ? GUTTER : 0), 0),
	);
	const canvasWidth = Math.max(0, ...widthsPerLayer);
	const canvas: LaidNode[][] = [];
	for (let li = 0; li < layers.length; li++) {
		const layer = layers[li] ?? [];
		const lw = widthsPerLayer[li] ?? 0;
		const startOffset = Math.floor((canvasWidth - lw) / 2);
		const laid: LaidNode[] = [];
		let cursor = startOffset;
		for (const n of layer) {
			const bw = _boxWidth(n, edges);
			laid.push({ data: n, boxStartX: cursor, boxWidth: bw, layerIndex: li });
			cursor += bw + GUTTER;
		}
		canvas.push(laid);
	}
	return { canvas, canvasWidth, widthOk: true, rawWidths: widthsPerLayer };
};

interface SlotMap {
	readonly outgoingSlotX: Map<string, number>;
	readonly incomingSlotX: Map<string, number>;
}

const _nodeCenter = (ln: LaidNode): number =>
	ln.boxStartX + Math.floor(ln.boxWidth / 2);

const _allocateMonotonic = (
	ideals: ReadonlyArray<number>,
	slotMinX: number,
	slotMaxX: number,
	minGap: number,
): number[] => {
	const N = ideals.length;
	if (N === 0) return [];
	const slots: number[] = ideals.map((x) =>
		Math.max(slotMinX, Math.min(slotMaxX, x)),
	);
	for (let i = 1; i < N; i++) {
		const prev = slots[i - 1] ?? slotMinX;
		const cur = slots[i] ?? slotMinX;
		if (cur - prev < minGap) slots[i] = prev + minGap;
	}
	if ((slots[N - 1] ?? slotMinX) > slotMaxX) {
		slots[N - 1] = slotMaxX;
		for (let i = N - 2; i >= 0; i--) {
			const next = slots[i + 1] ?? slotMaxX;
			const cur = slots[i] ?? slotMinX;
			if (next - cur < minGap) slots[i] = next - minGap;
		}
	}
	for (let i = 0; i < N; i++) {
		const cur = slots[i] ?? slotMinX;
		if (cur < slotMinX) slots[i] = slotMinX;
	}
	let leftRun = 0;
	while (leftRun < N && (slots[leftRun] ?? slotMinX) - slotMinX < minGap * leftRun + 1) {
		const expected = slotMinX + leftRun * minGap;
		if ((slots[leftRun] ?? slotMinX) === expected) leftRun++;
		else break;
	}
	if (leftRun > 1) {
		const rightBoundIdx = leftRun;
		const rightBound = rightBoundIdx < N
			? (slots[rightBoundIdx] ?? slotMaxX) - minGap
			: slotMaxX;
		const span = Math.max(0, rightBound - slotMinX);
		const visualGap = Math.max(minGap, 4);
		const usedSpan = Math.min(span, (leftRun - 1) * visualGap);
		for (let i = 0; i < leftRun; i++) {
			const t = leftRun === 1 ? 0 : i / (leftRun - 1);
			slots[i] = slotMinX + Math.round(t * usedSpan);
		}
	}
	let rightRun = 0;
	while (rightRun < N && slotMaxX - (slots[N - 1 - rightRun] ?? slotMaxX) < minGap * rightRun + 1) {
		const expected = slotMaxX - rightRun * minGap;
		if ((slots[N - 1 - rightRun] ?? slotMaxX) === expected) rightRun++;
		else break;
	}
	if (rightRun > 1) {
		const leftBoundIdx = N - 1 - rightRun;
		const leftBound = leftBoundIdx >= 0
			? (slots[leftBoundIdx] ?? slotMinX) + minGap
			: slotMinX;
		const span = Math.max(0, slotMaxX - leftBound);
		const visualGap = Math.max(minGap, 4);
		const usedSpan = Math.min(span, (rightRun - 1) * visualGap);
		for (let i = 0; i < rightRun; i++) {
			const t = rightRun === 1 ? 0 : i / (rightRun - 1);
			slots[N - 1 - i] = slotMaxX - Math.round(t * usedSpan);
		}
	}
	return slots;
};

const _computeNodeSlots = (
	laid: LaidNode,
	edges: ReadonlyArray<LayoutEdgeData>,
	positions: Map<string, LaidNode>,
	slotsByNode: Map<string, SlotMap>,
): SlotMap => {
	const outEdges = edges.filter((e) => e.from === laid.data.name);
	const inEdges = edges.filter((e) => e.to === laid.data.name);
	if (laid.data.real === null) {
		const x = _nodeCenter(laid);
		const out = new Map<string, number>();
		const inc = new Map<string, number>();
		for (const e of outEdges) out.set(e.to, x);
		for (const e of inEdges) inc.set(e.from, x);
		return { outgoingSlotX: out, incomingSlotX: inc };
	}
	const real = laid.data.real;
	const outOrdered = outEdges.slice().sort((a, b) => {
		const ac = positions.get(a.to);
		const bc = positions.get(b.to);
		const ax = ac ? _nodeCenter(ac) : 0;
		const bx = bc ? _nodeCenter(bc) : 0;
		if (ax === bx) return a.to.localeCompare(b.to);
		return ax - bx;
	});
	const outSlotMinX = laid.boxStartX + 1;
	const outSlotMaxX = laid.boxStartX + laid.boxWidth - 2;
	const outIdeals = outOrdered.map((e) => {
		const cn = positions.get(e.to);
		return cn ? _nodeCenter(cn) : _nodeCenter(laid);
	});
	const outSlotXs = _allocateMonotonic(outIdeals, outSlotMinX, outSlotMaxX, 2);
	const outgoing = new Map<string, number>();
	outOrdered.forEach((e, i) => {
		const x = outSlotXs[i];
		if (x !== undefined) outgoing.set(e.to, x);
	});
	const inOrdered = inEdges.slice().sort((a, b) => {
		const aParentSlot =
			slotsByNode.get(a.from)?.outgoingSlotX.get(laid.data.name);
		const bParentSlot =
			slotsByNode.get(b.from)?.outgoingSlotX.get(laid.data.name);
		const aFrom = positions.get(a.from);
		const bFrom = positions.get(b.from);
		const ax = aParentSlot ?? (aFrom ? _nodeCenter(aFrom) : 0);
		const bx = bParentSlot ?? (bFrom ? _nodeCenter(bFrom) : 0);
		if (ax === bx) return a.from.localeCompare(b.from);
		return ax - bx;
	});
	const M = inOrdered.length;
	const incoming = new Map<string, number>();
	if (M > 0) {
		const slotMinX = laid.boxStartX + 1;
		const slotMaxX = laid.boxStartX + laid.boxWidth - 2;
		const boxCenter = laid.boxStartX + Math.floor(laid.boxWidth / 2);
		const innerSpan = Math.max(1, laid.boxWidth - 2);
		const spacing = M > 1 ? innerSpan / (M + 1) : 0;
		const inIdeals = inOrdered.map((_e, i) => {
			if (M === 1) return boxCenter;
			return Math.round(boxCenter + (i - (M - 1) / 2) * spacing);
		});
		const inSlotXs = _allocateMonotonic(inIdeals, slotMinX, slotMaxX, 2);
		inOrdered.forEach((e, i) => {
			const x = inSlotXs[i];
			if (x !== undefined) incoming.set(e.from, x);
		});
	}
	void real;
	return { outgoingSlotX: outgoing, incomingSlotX: incoming };
};

const _renderBoxLines = (
	laid: LaidNode,
	outgoingSlotsByX: ReadonlyArray<number>,
	incomingSlotsByX: ReadonlyArray<number>,
): [string, string, string, string] => {
	const real = laid.data.real;
	const w = laid.boxWidth;
	if (real === null) {
		const offset = Math.floor(w / 2);
		const left = " ".repeat(offset);
		const right = " ".repeat(Math.max(0, w - offset - 1));
		const line = `${left}│${right}`;
		return [line, line, line, line];
	}
	const outSet = new Set(outgoingSlotsByX.map((x) => x - laid.boxStartX));
	const inSet = new Set(incomingSlotsByX.map((x) => x - laid.boxStartX));
	const topChars = Array.from({ length: w }, (_unused, i) => {
		if (i === 0) return "┌";
		if (i === w - 1) return "┐";
		if (inSet.has(i)) return "┴";
		return "─";
	}).join("");
	const innerWidth = w - 4;
	const namePadCount = Math.max(0, innerWidth - real.name.length);
	const nameRow = `│ ${real.name}${" ".repeat(namePadCount)} │`;
	const buildSeg = real.hasBuildScript ? BUILD_TOKEN : "";
	const midPadCount = Math.max(0, innerWidth - real.relDir.length - buildSeg.length);
	const midPad = " ".repeat(midPadCount);
	const midRow = `│ ${real.relDir}${midPad}${buildSeg} │`;
	const botChars = Array.from({ length: w }, (_unused, i) => {
		if (i === 0) return "└";
		if (i === w - 1) return "┘";
		if (outSet.has(i)) return "┬";
		return "─";
	}).join("");
	return [topChars, nameRow, midRow, botChars];
};

class CharGrid {
	private rows: string[][];
	public readonly width: number;
	public readonly height: number;

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.rows = Array.from({ length: height }, () =>
			Array.from({ length: width }, () => " "),
		);
	}

	put(x: number, y: number, ch: string): void {
		if (y < 0 || y >= this.height || x < 0 || x >= this.width) return;
		const row = this.rows[y];
		if (!row) return;
		const existing = row[x] ?? " ";
		row[x] = this._merge(existing, ch);
	}

	putString(x: number, y: number, s: string): void {
		for (let i = 0; i < s.length; i++) {
			const ch = s[i];
			if (ch !== undefined) this.put(x + i, y, ch);
		}
	}

	toString(): string {
		return this.rows.map((r) => r.join("").replace(/\s+$/, "")).join("\n");
	}

	private _merge(a: string, b: string): string {
		if (a === " ") return b;
		if (b === " ") return a;
		if (a === b) return a;
		const pair = `${a}${b}`;
		if (pair === "│─" || pair === "─│") return "┼";
		if (pair === "╎─" || pair === "─╎") return "┼";
		if (pair === "│╎" || pair === "╎│") return "│";
		if (a === "▼" || b === "▼") return "▼";
		if (a === "▽" || b === "▽") return "▽";
		if (a === "┬" || b === "┬") return "┬";
		if (a === "┴" || b === "┴") return "┴";
		return b;
	}
}

const _routeEdge = (
	grid: CharGrid,
	startX: number,
	endX: number,
	startY: number,
	endY: number,
	kind: EdgeKind,
	drawArrow: boolean,
	turnY: number,
): void => {
	const vert = kind === "dev" ? "╎" : "│";
	const horiz = "─";
	const arrowOffset = drawArrow ? 1 : 0;
	for (let y = startY; y < turnY; y++) grid.put(startX, y, vert);
	if (startX === endX) {
		grid.put(startX, turnY, vert);
	} else if (startX < endX) {
		grid.put(startX, turnY, "└");
		for (let x = startX + 1; x < endX; x++) grid.put(x, turnY, horiz);
		grid.put(endX, turnY, "┐");
	} else {
		grid.put(startX, turnY, "┘");
		for (let x = endX + 1; x < startX; x++) grid.put(x, turnY, horiz);
		grid.put(endX, turnY, "┌");
	}
	for (let y = turnY + 1; y < endY - arrowOffset; y++) grid.put(endX, y, vert);
	if (drawArrow) {
		grid.put(endX, endY - 1, kind === "dev" ? "▽" : "▼");
	} else {
		grid.put(endX, endY, vert);
	}
};

const _renderHeader = (
	target: string | undefined,
	realCount: number,
	runtimeCount: number,
	devCount: number,
	withDev: boolean,
	reduce: boolean,
): string => {
	const label = target ? `closure: ${target}` : "monorepo workspaces";
	const parts: string[] = [`${realCount} workspaces`];
	parts.push(`${runtimeCount} runtime edge${runtimeCount === 1 ? "" : "s"}`);
	if (withDev) parts.push(`${devCount} dev edge${devCount === 1 ? "" : "s"}`);
	if (!reduce) parts.push("full");
	return `${label}  ·  ${parts.join("  ·  ")}`;
};

const _renderLegend = (withDev: boolean, showBuild: boolean): string => {
	const items: string[] = [];
	if (showBuild) items.push(`${BUILD_TOKEN} = has build script`);
	items.push("▼ = runtime edge");
	if (withDev) items.push("▽ = dev edge");
	return `legend:  ${items.join("   ")}`;
};

const _renderTree = (
	nodes: ReadonlyArray<GraphNode>,
	edges: ReadonlyArray<GraphEdge>,
	target: string | undefined,
): string => {
	const adj = _adjacency(edges);
	const byName = new Map(nodes.map((n) => [n.name, n]));
	const seen = new Set<string>();
	const lines: string[] = [];
	const formatNode = (n: GraphNode, suffix: string): string => {
		const build = n.hasBuildScript ? `  ${BUILD_TOKEN}` : "";
		return `${n.name}  ${n.relDir}${build}${suffix}`;
	};
	const walk = (
		name: string,
		prefix: string,
		isLast: boolean,
		isRoot: boolean,
		edgeKind: EdgeKind | null,
	): void => {
		const n = byName.get(name);
		if (!n) return;
		const connector = isRoot ? "" : isLast ? "└── " : "├── ";
		const kindTag = edgeKind === "dev" ? "  (dev)" : "";
		if (seen.has(name)) {
			lines.push(`${prefix}${connector}${n.name}${kindTag}  (see above)`);
			return;
		}
		seen.add(name);
		lines.push(`${prefix}${connector}${formatNode(n, kindTag)}`);
		const kids = (adj.get(name) ?? []).slice().sort();
		const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
		const kidEdges = kids.map((k) => {
			const eForK = edges.find((e) => e.from === name && e.to === k);
			return { name: k, kind: eForK?.kind ?? "runtime" };
		});
		kidEdges.forEach((ek, i) => {
			walk(ek.name, childPrefix, i === kidEdges.length - 1, false, ek.kind);
		});
	};
	if (target !== undefined) {
		walk(target, "", true, true, null);
	} else {
		const rev = _reverseAdjacency(edges);
		const roots = nodes
			.filter((n) => (rev.get(n.name)?.length ?? 0) === 0)
			.map((n) => n.name)
			.sort();
		roots.forEach((r, i) => {
			walk(r, "", i === roots.length - 1, true, null);
		});
	}
	return lines.join("\n");
};

const _renderDag = (
	canvas: LaidNode[][],
	canvasWidth: number,
	layoutEdges: ReadonlyArray<LayoutEdgeData>,
): string => {
	const positions = new Map<string, LaidNode>();
	for (const layer of canvas) for (const ln of layer) positions.set(ln.data.name, ln);
	const slotsByNode = new Map<string, SlotMap>();
	for (const layer of canvas) {
		for (const ln of layer) {
			slotsByNode.set(
				ln.data.name,
				_computeNodeSlots(ln, layoutEdges, positions, slotsByNode),
			);
		}
	}
	const numLayers = canvas.length;
	const edgesByBoundary = new Map<number, LayoutEdgeData[]>();
	for (const e of layoutEdges) {
		const fromNode = positions.get(e.from);
		if (!fromNode) continue;
		const list = edgesByBoundary.get(fromNode.layerIndex) ?? [];
		list.push(e);
		edgesByBoundary.set(fromNode.layerIndex, list);
	}
	const routeRowsAt: number[] = [];
	for (let i = 0; i < Math.max(0, numLayers - 1); i++) {
		const count = edgesByBoundary.get(i)?.length ?? 0;
		routeRowsAt.push(Math.max(MIN_ROUTE_ROWS, count + 1));
	}
	const layerTopRow: number[] = [0];
	for (let i = 1; i < numLayers; i++) {
		const prevTop = layerTopRow[i - 1] ?? 0;
		const routeRows = routeRowsAt[i - 1] ?? MIN_ROUTE_ROWS;
		layerTopRow.push(prevTop + BOX_ROWS + routeRows);
	}
	const gridHeight = (layerTopRow[numLayers - 1] ?? 0) + BOX_ROWS;
	const grid = new CharGrid(canvasWidth, gridHeight);
	for (let li = 0; li < canvas.length; li++) {
		const layer = canvas[li] ?? [];
		const topRow = layerTopRow[li] ?? 0;
		for (const ln of layer) {
			const slots = slotsByNode.get(ln.data.name);
			const outSlots = slots ? Array.from(slots.outgoingSlotX.values()) : [];
			const inSlots = slots ? Array.from(slots.incomingSlotX.values()) : [];
			const lines = _renderBoxLines(ln, outSlots, inSlots);
			for (let r = 0; r < lines.length; r++) {
				const line = lines[r];
				if (line !== undefined) grid.putString(ln.boxStartX, topRow + r, line);
			}
		}
	}
	for (const [boundary, boundaryEdges] of edgesByBoundary) {
		const ordered = boundaryEdges.slice().sort((a, b) => {
			const aStart = slotsByNode.get(a.from)?.outgoingSlotX.get(a.to) ?? 0;
			const aEnd = slotsByNode.get(a.to)?.incomingSlotX.get(a.from) ?? 0;
			const bStart = slotsByNode.get(b.from)?.outgoingSlotX.get(b.to) ?? 0;
			const bEnd = slotsByNode.get(b.to)?.incomingSlotX.get(b.from) ?? 0;
			const aDist = Math.abs(aStart - aEnd);
			const bDist = Math.abs(bStart - bEnd);
			if (aDist === bDist) return bStart - aStart;
			return bDist - aDist;
		});
		const routeRows = routeRowsAt[boundary] ?? MIN_ROUTE_ROWS;
		const turnSlotsCount = Math.max(1, routeRows - 1);
		interface PlacedRoute {
			readonly startX: number;
			readonly endX: number;
			readonly turnY: number;
		}
		const placed: PlacedRoute[] = [];
		const overlap = (
			loA: number,
			hiA: number,
			loB: number,
			hiB: number,
		): boolean => loA <= hiB && loB <= hiA;
		const wouldCross = (
			startX: number,
			endX: number,
			turnY: number,
			parentBotRow: number,
			childTopRow: number,
		): number => {
			const horizLo = Math.min(startX, endX);
			const horizHi = Math.max(startX, endX);
			let cost = 0;
			for (const p of placed) {
				const pHorizLo = Math.min(p.startX, p.endX);
				const pHorizHi = Math.max(p.startX, p.endX);
				const pVertAboveActive = p.turnY > parentBotRow + 1;
				const pVertBelowActive = p.turnY < childTopRow - 1;
				if (
					pVertAboveActive &&
					p.startX >= horizLo &&
					p.startX <= horizHi &&
					p.turnY > turnY
				) {
					cost += 4;
				}
				if (
					pVertBelowActive &&
					p.endX >= horizLo &&
					p.endX <= horizHi &&
					p.turnY < turnY
				) {
					cost += 4;
				}
				if (
					turnY > parentBotRow + 1 &&
					startX >= pHorizLo &&
					startX <= pHorizHi &&
					p.turnY < turnY
				) {
					cost += 4;
				}
				if (
					turnY < childTopRow - 1 &&
					endX >= pHorizLo &&
					endX <= pHorizHi &&
					p.turnY > turnY
				) {
					cost += 4;
				}
				if (p.turnY === turnY && overlap(horizLo, horizHi, pHorizLo, pHorizHi)) {
					cost += 1;
				}
			}
			return cost;
		};
		for (const e of ordered) {
			const fromNode = positions.get(e.from);
			const toNode = positions.get(e.to);
			if (!fromNode || !toNode) continue;
			const fromSlots = slotsByNode.get(e.from);
			const toSlots = slotsByNode.get(e.to);
			if (!fromSlots || !toSlots) continue;
			const startX = fromSlots.outgoingSlotX.get(e.to);
			const endX = toSlots.incomingSlotX.get(e.from);
			if (startX === undefined || endX === undefined) continue;
			const parentBotRow = (layerTopRow[fromNode.layerIndex] ?? 0) + BOX_ROWS - 1;
			const childTopRow = layerTopRow[toNode.layerIndex] ?? 0;
			let bestTurnY = parentBotRow + 1;
			let bestCrossings = Number.POSITIVE_INFINITY;
			for (let t = 0; t < turnSlotsCount; t++) {
				const tryY = parentBotRow + 1 + t;
				const c = wouldCross(startX, endX, tryY, parentBotRow, childTopRow);
				if (c < bestCrossings) {
					bestCrossings = c;
					bestTurnY = tryY;
				}
			}
			placed.push({ startX, endX, turnY: bestTurnY });
			_routeEdge(grid, startX, endX, parentBotRow + 1, childTopRow, e.kind, e.isFinal, bestTurnY);
		}
	}
	return grid.toString();
};

export const renderGraph = (input: RenderInput): string => {
	const reduce = input.reduce === true;
	const filtered = _activeEdges(input.edges, input.withDev);
	const scope =
		input.target !== undefined
			? _reachableFromTarget(input.nodes, filtered, input.target)
			: { nodes: input.nodes.slice(), edges: filtered.slice() };
	const nodes = scope.nodes;
	const edgesAfterScope = scope.edges;
	const edges = reduce ? _transitiveReduce(nodes, edgesAfterScope) : edgesAfterScope;
	if (nodes.length === 0) {
		return input.target !== undefined
			? `(target '${input.target}' not found in workspace set)`
			: "(no workspaces found)";
	}
	const ranks = _computeRanks(nodes, edges, input.target);
	const { layoutNodes, layoutEdges } = _insertDummies(nodes, edges, ranks);
	const initialLayers = _groupLayers(layoutNodes);
	const orderedLayers = _barycenterReorder(initialLayers, layoutEdges);
	const layout = _layoutLayers(orderedLayers, layoutEdges);
	const runtimeCount = edges.filter((e) => e.kind === "runtime").length;
	const devCount = edges.filter((e) => e.kind === "dev").length;
	const showBuild = nodes.some((n) => n.hasBuildScript);
	const header = _renderHeader(
		input.target,
		nodes.length,
		runtimeCount,
		devCount,
		input.withDev,
		reduce,
	);
	const legend = _renderLegend(input.withDev, showBuild);
	if (layout.canvasWidth > input.width) {
		const notice = `⚠ graph wider than terminal (${layout.canvasWidth} > ${input.width} cols); falling back to tree view.  Pass --width to override.`;
		const tree = _renderTree(nodes, edges, input.target);
		return [header, notice, "", tree, "", legend].join("\n");
	}
	const dag = _renderDag(layout.canvas, layout.canvasWidth, layoutEdges);
	return [header, "", dag, "", legend].join("\n");
};
