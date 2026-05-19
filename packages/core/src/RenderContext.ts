export interface RenderContext {
	readonly env: string;
}

export const RenderContext = {
	make: (env: string): RenderContext => ({ env }),
};
