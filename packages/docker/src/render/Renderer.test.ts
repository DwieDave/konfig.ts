import { describe, expect, it } from "vitest";
import type { Dockerfile, Instruction, Stage } from "../ir/DockerfileIR";
import { render } from "./Renderer";

const stage = (
	name: string,
	instructions: ReadonlyArray<Instruction>,
	base?: string | { image: string; tag: string },
): Stage => ({
	name,
	from:
		base === undefined
			? { _tag: "FromStage", stage: "base" }
			: typeof base === "string"
				? { _tag: "FromImage", image: base, tag: "latest" }
				: { _tag: "FromImage", image: base.image, tag: base.tag },
	instructions,
});

const df = (stages: ReadonlyArray<Stage>): Dockerfile => ({ args: [], stages });

describe("Renderer per-instruction snapshots", () => {
	it("emits FROM image:tag AS name", () => {
		const out = render(df([stage("base", [], { image: "oven/bun", tag: "1.3.5-alpine" })]));
		expect(out).toBe("FROM oven/bun:1.3.5-alpine AS base\n");
	});

	it("emits FROM stage AS name for FromStage", () => {
		const out = render(df([stage("runner", [])]));
		expect(out).toBe("FROM base AS runner\n");
	});

	it("emits FROM with --platform flag for single platform", () => {
		const s: Stage = {
			name: "base",
			from: { _tag: "FromImage", image: "alpine", tag: "3.20" },
			platform: { _tag: "Single", value: "linux/amd64" },
			instructions: [],
		};
		expect(render(df([s]))).toBe("FROM --platform=linux/amd64 alpine:3.20 AS base\n");
	});

	it("emits Copy with flags", () => {
		const i: Instruction = {
			_tag: "Copy",
			from: "deps",
			chown: "bunjs:bunjs",
			src: ["src/a", "src/b"],
			dst: "dst/",
		};
		expect(render(df([stage("x", [i])]))).toBe(
			"FROM base AS x\nCOPY --from=deps --chown=bunjs:bunjs src/a src/b dst/\n",
		);
	});

	it("emits Copy without optional flags", () => {
		const i: Instruction = { _tag: "Copy", src: ["src"], dst: "dst" };
		expect(render(df([stage("x", [i])]))).toContain("\nCOPY src dst");
	});

	it("emits Run", () => {
		expect(render(df([stage("x", [{ _tag: "Run", cmd: "bun install" }])]))).toContain(
			"\nRUN bun install",
		);
	});

	it("emits Env multi-pair", () => {
		const i: Instruction = {
			_tag: "Env",
			entries: [
				["NODE_ENV", "production"],
				["PORT", "4000"],
			],
		};
		expect(render(df([stage("x", [i])]))).toContain("\nENV NODE_ENV=production PORT=4000");
	});

	it("quotes env values containing spaces", () => {
		const i: Instruction = { _tag: "Env", entries: [["MSG", "hello world"]] };
		expect(render(df([stage("x", [i])]))).toContain(`\nENV MSG="hello world"`);
	});

	it("emits Expose with port", () => {
		expect(render(df([stage("x", [{ _tag: "Expose", port: 4000 }])]))).toContain(
			"\nEXPOSE 4000",
		);
	});

	it("emits Expose with protocol", () => {
		expect(
			render(df([stage("x", [{ _tag: "Expose", port: 5353, protocol: "udp" }])])),
		).toContain("\nEXPOSE 5353/udp");
	});

	it("emits User", () => {
		expect(render(df([stage("x", [{ _tag: "User", user: "bunjs" }])]))).toContain(
			"\nUSER bunjs",
		);
	});

	it("emits Workdir", () => {
		expect(render(df([stage("x", [{ _tag: "Workdir", path: "/app" }])]))).toContain(
			"\nWORKDIR /app",
		);
	});

	it("emits Cmd in exec form (JSON array)", () => {
		expect(render(df([stage("x", [{ _tag: "Cmd", argv: ["bun", "main.ts"] }])]))).toContain(
			`\nCMD ["bun","main.ts"]`,
		);
	});

	it("emits Entrypoint in exec form", () => {
		expect(
			render(df([stage("x", [{ _tag: "Entrypoint", argv: ["/sbin/init"] }])])),
		).toContain(`\nENTRYPOINT ["/sbin/init"]`);
	});

	it("emits Healthcheck NONE", () => {
		expect(
			render(df([stage("x", [{ _tag: "Healthcheck", check: { _tag: "None" } }])])),
		).toContain("\nHEALTHCHECK NONE");
	});

	it("emits Healthcheck CMD with flags", () => {
		const out = render(
			df([
				stage("x", [
					{
						_tag: "Healthcheck",
						check: {
							_tag: "Cmd",
							argv: ["curl", "-f", "http://localhost:4000/health"],
							interval: "30s",
							timeout: "10s",
							retries: 3,
							startPeriod: "5s",
						},
					},
				]),
			]),
		);
		expect(out).toContain(
			`\nHEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=5s CMD ["curl","-f","http://localhost:4000/health"]`,
		);
	});

	it("inserts stage-level WORKDIR before instructions", () => {
		const s: Stage = {
			name: "x",
			from: { _tag: "FromStage", stage: "base" },
			workdir: "/app",
			instructions: [{ _tag: "Run", cmd: "ls" }],
		};
		expect(render(df([s]))).toBe("FROM base AS x\nWORKDIR /app\nRUN ls\n");
	});

	it("separates multiple stages with blank lines", () => {
		const a = stage("a", [{ _tag: "Run", cmd: "echo a" }], "alpine");
		const b = stage("b", [{ _tag: "Run", cmd: "echo b" }]);
		expect(render(df([a, b]))).toBe(
			"FROM alpine:latest AS a\nRUN echo a\n\nFROM base AS b\nRUN echo b\n",
		);
	});

	it("emits ARG entries when present", () => {
		const out = render({
			args: [
				{ name: "VERSION" },
				{ name: "TAG", default: "latest" },
			],
			stages: [stage("a", [], "alpine")],
		});
		expect(out.startsWith("ARG VERSION\nARG TAG=latest\n\nFROM alpine:latest AS a")).toBe(true);
	});
});
