import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Combine, Deps, Kind, Subtract } from "./types";
import { KINDS } from "./types";

type DepNames = { [K in Kind]: ReadonlySet<string> };

const _empty = (): DepNames => ({
	Secret: new Set(),
	ConfigMap: new Set(),
	Namespace: new Set(),
	ServiceAccount: new Set(),
	Application: new Set(),
});

const _subtract = (r: DepNames, p: DepNames): DepNames => {
	const out = _empty();
	for (const k of KINDS) {
		const set = new Set<string>();
		for (const name of r[k]) if (!p[k].has(name)) set.add(name);
		out[k] = set;
	}
	return out;
};

const _unionDeps = (a: DepNames, b: DepNames): DepNames => {
	const out = _empty();
	for (const k of KINDS) {
		out[k] = new Set([...a[k], ...b[k]]);
	}
	return out;
};

const _combine = (
	r1: DepNames,
	p1: DepNames,
	r2: DepNames,
	p2: DepNames,
): { R: DepNames; P: DepNames } => ({
	R: _subtract(_unionDeps(r1, r2), _unionDeps(p1, p2)),
	P: _unionDeps(p1, p2),
});

const _equal = (a: DepNames, b: DepNames): boolean => {
	for (const k of KINDS) {
		if (a[k].size !== b[k].size) return false;
		for (const name of a[k]) if (!b[k].has(name)) return false;
	}
	return true;
};

const arbDeps: fc.Arbitrary<DepNames> = fc
	.record({
		Secret: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 4 }),
		ConfigMap: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 4 }),
		Namespace: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 4 }),
		ServiceAccount: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 4 }),
		Application: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { maxLength: 4 }),
	})
	.map((r) => ({
		Secret: new Set(r.Secret),
		ConfigMap: new Set(r.ConfigMap),
		Namespace: new Set(r.Namespace),
		ServiceAccount: new Set(r.ServiceAccount),
		Application: new Set(r.Application),
	}));

describe("Subtract", () => {
	it("subtracting Empty is identity", () => {
		fc.assert(
			fc.property(arbDeps, (r) => {
				expect(_equal(_subtract(r, _empty()), r)).toBe(true);
			}),
		);
	});

	it("subtracting self is Empty", () => {
		fc.assert(
			fc.property(arbDeps, (r) => {
				expect(_equal(_subtract(r, r), _empty())).toBe(true);
			}),
		);
	});

	it("idempotent: subtract(subtract(r, p), p) === subtract(r, p)", () => {
		fc.assert(
			fc.property(arbDeps, arbDeps, (r, p) => {
				const once = _subtract(r, p);
				const twice = _subtract(once, p);
				expect(_equal(once, twice)).toBe(true);
			}),
		);
	});
});

describe("Combine", () => {
	it("combine with Empty/Empty leaves R/P unchanged", () => {
		fc.assert(
			fc.property(arbDeps, arbDeps, (r, p) => {
				const result = _combine(r, p, _empty(), _empty());
				expect(_equal(result.R, _subtract(r, p))).toBe(true);
				expect(_equal(result.P, p)).toBe(true);
			}),
		);
	});

	it("commutative on P", () => {
		fc.assert(
			fc.property(arbDeps, arbDeps, arbDeps, arbDeps, (r1, p1, r2, p2) => {
				const ab = _combine(r1, p1, r2, p2);
				const ba = _combine(r2, p2, r1, p1);
				expect(_equal(ab.P, ba.P)).toBe(true);
				expect(_equal(ab.R, ba.R)).toBe(true);
			}),
		);
	});

	it("self-providing manifest discharges its own deps", () => {
		fc.assert(
			fc.property(arbDeps, (p) => {
				const result = _combine(p, p, _empty(), _empty());
				expect(_equal(result.R, _empty())).toBe(true);
				expect(_equal(result.P, p)).toBe(true);
			}),
		);
	});
});

type _Same<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _Empty = {
	readonly Secret: never;
	readonly ConfigMap: never;
	readonly Namespace: never;
	readonly ServiceAccount: never;
	readonly Application: never;
};

type _R1 = {
	readonly Secret: "a";
	readonly ConfigMap: never;
	readonly Namespace: never;
	readonly ServiceAccount: never;
	readonly Application: never;
};
type _RminusEmpty = Subtract<_R1, _Empty>;
const _r1: _Same<_RminusEmpty, _R1> = true;

type _RminusR = Subtract<_R1, _R1>;
const _r2: _Same<_RminusR, _Empty> = true;

type _Provides = {
	readonly Secret: "a";
	readonly ConfigMap: never;
	readonly Namespace: never;
	readonly ServiceAccount: never;
	readonly Application: never;
};
type _Combined = Combine<_R1, _Empty, _Empty, _Provides>;
const _r3: _Same<_Combined["R"], _Empty> = true;
const _r4: _Same<_Combined["P"], _Provides> = true;

void _r1;
void _r2;
void _r3;
void _r4;

// oxlint-disable-next-line app/no-banned-type-assertions app/no-type-assertion
void (null as unknown as Deps);
