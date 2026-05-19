
export type Kind = "Secret" | "ConfigMap" | "Namespace" | "ServiceAccount" | "Application";

export const KINDS: readonly Kind[] = [
	"Secret",
	"ConfigMap",
	"Namespace",
	"ServiceAccount",
	"Application",
];
