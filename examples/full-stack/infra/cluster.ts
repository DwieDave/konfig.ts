export const cluster = {
	domain: "example.dev",
	repositoryUrl: "ssh://git@github.com/example/full-stack.git",
} as const;

export type Cluster = typeof cluster;
