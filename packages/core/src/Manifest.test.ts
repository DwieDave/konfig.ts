import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Combine, Deps, Kind, Subtract } from "./types";
import { KINDS } from "./types";

// Property-test harness for the Subtract/Combine algebra. The runtime values
// here mirror the type-level operators so we can drive `fast-check` against
// them; the corresponding type-level identities are asserted with
// `expectTypeOf`-style checks (see the static assertions at the bottom).

type DepNames = { [K in Kind]: ReadonlySet<string> };

const empty = (): DepNames => ({
	Secret: new Set(),
	ConfigMap: new Set(),
	Namespace: new Set(),
	ServiceAccount: new Set(),
	Application: new Set(),
});

const subtract = (r: DepNames, p: DepNames): DepNames => {
	const out = empty();
	for (const k of KINDS) {
		const set = new Set<string>();
		for (const name of r[k]) if (!p[k].has(name)) set.add(name);
		out[k] = set;
	}
	return out;
};

const unionDeps = (a: DepNames, b: DepNames): DepNames => {
	const out = empty();
	for (const k of KINDS) {
		out[k] = new Set([...a[k], ...b[k]]);
	}
	return out;
};

const combine = (
	r1: DepNames,
	p1: DepNames,
	r2: DepNames,
	p2: DepNames,
): { R: DepNames; P: DepNames } => ({
	R: subtract(unionDeps(r1, r2), unionDeps(p1, p2)),
	P: unionDeps(p1, p2),
});

const equal = (a: DepNames, b: DepNames): boolean => {
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
				expect(equal(subtract(r, empty()), r)).toBe(true);
			}),
		);
	});

	it("subtracting self is Empty", () => {
		fc.assert(
			fc.property(arbDeps, (r) => {
				expect(equal(subtract(r, r), empty())).toBe(true);
			}),
		);
	});

	it("idempotent: subtract(subtract(r, p), p) === subtract(r, p)", () => {
		fc.assert(
			fc.property(arbDeps, arbDeps, (r, p) => {
				const once = subtract(r, p);
				const twice = subtract(once, p);
				expect(equal(once, twice)).toBe(true);
			}),
		);
	});
});

describe("Combine", () => {
	it("combine with Empty/Empty leaves R/P unchanged", () => {
		fc.assert(
			fc.property(arbDeps, arbDeps, (r, p) => {
				const result = combine(r, p, empty(), empty());
				// subtract(r ∪ ∅, p ∪ ∅) = subtract(r, p), which equals r minus p.
				expect(equal(result.R, subtract(r, p))).toBe(true);
				expect(equal(result.P, p)).toBe(true);
			}),
		);
	});

	it("commutative on P", () => {
		fc.assert(
			fc.property(arbDeps, arbDeps, arbDeps, arbDeps, (r1, p1, r2, p2) => {
				const ab = combine(r1, p1, r2, p2);
				const ba = combine(r2, p2, r1, p1);
				expect(equal(ab.P, ba.P)).toBe(true);
				expect(equal(ab.R, ba.R)).toBe(true);
			}),
		);
	});

	it("self-providing manifest discharges its own deps", () => {
		fc.assert(
			fc.property(arbDeps, (p) => {
				// A manifest that requires exactly what it provides should combine
				// with anything to leave its own requirements discharged.
				const result = combine(p, p, empty(), empty());
				expect(equal(result.R, empty())).toBe(true);
				expect(equal(result.P, p)).toBe(true);
			}),
		);
	});
});

// ---- Type-level assertions (compile-time only; nothing to run) -------------

type _Same<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _Empty = {
	readonly Secret: never;
	readonly ConfigMap: never;
	readonly Namespace: never;
	readonly ServiceAccount: never;
	readonly Application: never;
};

// Subtract<R, Empty> = R (compares to a Readonly-stripped view since Subtract
// always produces readonly fields).
type _R1 = {
	readonly Secret: "a";
	readonly ConfigMap: never;
	readonly Namespace: never;
	readonly ServiceAccount: never;
	readonly Application: never;
};
type _RminusEmpty = Subtract<_R1, _Empty>;
const _r1: _Same<_RminusEmpty, _R1> = true;

// Subtract<R, R> = Empty.
type _RminusR = Subtract<_R1, _R1>;
const _r2: _Same<_RminusR, _Empty> = true;

// Combine algebra: a manifest that requires "a" combined with one that
// provides "a" should have Empty remaining requirements.
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

// Touch the unused locals so the linter doesn't strip them.
void _r1;
void _r2;
void _r3;
void _r4;

// Reference an unused arbitrary import to silence dead-code lint:
void (null as unknown as Deps);
