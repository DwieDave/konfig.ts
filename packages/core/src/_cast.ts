// oxlint-disable-next-line app/no-banned-type-assertions app/no-type-assertion
export const brand = <T>(value: string): T => value as unknown as T;

// oxlint-disable-next-line app/no-type-assertion
export const coerce = <T>(value: unknown): T => value as T;
