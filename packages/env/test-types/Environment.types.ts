// Compile-time-only assertions for the env-contract types.

import type { Config, Redacted } from "effect";
import type {
	defineEnvironment,
	defineLiteral,
	defineSecret,
	EnvironmentShape,
	MemberValue,
} from "@konfig.ts/env";

type Expect<T extends true> = T;
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

// 1 · `defineLiteral` with a typed `value` carries the type into the
//     bundle yield.
declare const port: ReturnType<typeof defineLiteral<"PORT", number>>;
type _Port_Value = Expect<Equal<MemberValue<typeof port>, number>>;

// 2 · `defineSecret` yields `{[k in K]: Redacted<string>}`.
declare const dbCreds: ReturnType<
	typeof defineSecret<
		"db",
		{ readonly url: "DATABASE_URL"; readonly password: "DATABASE_PASSWORD" }
	>
>;
type _DbCreds_Value = Expect<
	Equal<
		MemberValue<typeof dbCreds>,
		{
			readonly url: Redacted.Redacted<string>;
			readonly password: Redacted.Redacted<string>;
		}
	>
>;

// 3 · `defineEnvironment({...})` flattens the per-member shape into
//     an `EnvironmentShape<M>`.
declare const bundle: ReturnType<
	typeof defineEnvironment<{
		readonly db: typeof dbCreds;
		readonly port: typeof port;
	}>
>;

type _Bundle_Shape = Expect<
	Equal<
		EnvironmentShape<{
			readonly db: typeof dbCreds;
			readonly port: typeof port;
		}>,
		{
			readonly db: {
				readonly url: Redacted.Redacted<string>;
				readonly password: Redacted.Redacted<string>;
			};
			readonly port: number;
		}
	>
>;

// 4 · An Environment is a Config of its shape.
declare const cfg: Config.Config<EnvironmentShape<{
	readonly db: typeof dbCreds;
	readonly port: typeof port;
}>>;
type _Bundle_IsConfig = Expect<
	Equal<typeof bundle extends Config.Config<infer T> ? T : never, typeof cfg extends Config.Config<infer U> ? U : never>
>;

export type _Tests = readonly [
	_Port_Value,
	_DbCreds_Value,
	_Bundle_Shape,
	_Bundle_IsConfig,
];
