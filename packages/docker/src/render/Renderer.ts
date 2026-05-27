import type {
	Dockerfile,
	From,
	HealthcheckIR,
	Instruction,
	PlatformIR,
	Stage,
} from "../ir/DockerfileIR";

const json = (argv: ReadonlyArray<string>): string => JSON.stringify(argv);

const renderPlatformFlag = (p: PlatformIR | undefined): string => {
	if (!p) return "";
	if (p._tag === "Single") return `--platform=${p.value} `;
	return "";
};

const renderFrom = (f: From, platform: PlatformIR | undefined, name: string): string => {
	const platformFlag = renderPlatformFlag(platform);
	if (f._tag === "FromImage") return `FROM ${platformFlag}${f.image}:${f.tag} AS ${name}`;
	return `FROM ${platformFlag}${f.stage} AS ${name}`;
};

const renderCopy = (i: Extract<Instruction, { _tag: "Copy" }>): string => {
	const flags: string[] = [];
	if (i.from) flags.push(`--from=${i.from}`);
	if (i.chown) flags.push(`--chown=${i.chown}`);
	const flagStr = flags.length === 0 ? "" : `${flags.join(" ")} `;
	return `COPY ${flagStr}${i.src.join(" ")} ${i.dst}`;
};

const renderEnv = (i: Extract<Instruction, { _tag: "Env" }>): string => {
	const pairs = i.entries.map(([k, v]) => `${k}=${quoteIfNeeded(v)}`).join(" ");
	return `ENV ${pairs}`;
};

const quoteIfNeeded = (v: string): string => {
	if (/[\s"'\\]/.test(v)) return JSON.stringify(v);
	return v;
};

const renderHealthcheck = (h: HealthcheckIR): string => {
	if (h._tag === "None") return "HEALTHCHECK NONE";
	const flags: string[] = [];
	if (h.interval) flags.push(`--interval=${h.interval}`);
	if (h.timeout) flags.push(`--timeout=${h.timeout}`);
	if (h.retries !== undefined) flags.push(`--retries=${h.retries}`);
	if (h.startPeriod) flags.push(`--start-period=${h.startPeriod}`);
	const flagStr = flags.length === 0 ? "" : `${flags.join(" ")} `;
	return `HEALTHCHECK ${flagStr}CMD ${json(h.argv)}`;
};

const renderInstruction = (i: Instruction): string => {
	switch (i._tag) {
		case "Copy":
			return renderCopy(i);
		case "Run":
			return `RUN ${i.cmd}`;
		case "Env":
			return renderEnv(i);
		case "Expose":
			return `EXPOSE ${i.port}${i.protocol ? `/${i.protocol}` : ""}`;
		case "User":
			return `USER ${i.user}`;
		case "Workdir":
			return `WORKDIR ${i.path}`;
		case "Cmd":
			return `CMD ${json(i.argv)}`;
		case "Entrypoint":
			return `ENTRYPOINT ${json(i.argv)}`;
		case "Healthcheck":
			return renderHealthcheck(i.check);
	}
};

const renderStage = (s: Stage): string => {
	const lines: string[] = [renderFrom(s.from, s.platform, s.name)];
	if (s.workdir) lines.push(`WORKDIR ${s.workdir}`);
	for (const i of s.instructions) lines.push(renderInstruction(i));
	return lines.join("\n");
};

const renderArg = (a: { name: string; default?: string }): string =>
	a.default === undefined ? `ARG ${a.name}` : `ARG ${a.name}=${a.default}`;

export const render = (df: Dockerfile): string => {
	const sections: string[] = [];
	if (df.args.length > 0) sections.push(df.args.map(renderArg).join("\n"));
	for (const s of df.stages) sections.push(renderStage(s));
	return `${sections.join("\n\n")}\n`;
};
