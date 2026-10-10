/** How one environment variable is parsed, and what happens when it is absent. */
export interface Spec<T> {
	readonly parse: (raw: string) => T;
	readonly fallback: { readonly value: T } | undefined;
	readonly optional: boolean;
}

interface SpecOptions<T> {
	readonly default?: T;
	readonly optional?: boolean;
}

/**
 * Builds a spec. Called with nothing the variable is required, with `default`
 * it falls back to that value, and with `optional: true` it may be `undefined`.
 */
export interface SpecFactory<T> {
	(): Spec<T>;
	(options: { readonly default: T }): Spec<T>;
	(options: { readonly optional: true }): Spec<T | undefined>;
}

function makeSpec<T>(
	parse: (raw: string) => T,
	options: SpecOptions<T>,
): Spec<T> {
	return {
		parse,
		fallback:
			options.default === undefined ? undefined : { value: options.default },
		optional: options.optional === true,
	};
}

/**
 * Turns a parse function into a validator. `parse` should return the parsed
 * value or throw an `Error` whose message completes the sentence "KEY ...".
 */
export function validator<T>(parse: (raw: string) => T): SpecFactory<T> {
	return ((options: SpecOptions<T> = {}) =>
		makeSpec(parse, options)) as SpecFactory<T>;
}

function parseNumber(raw: string): number {
	const text = raw.trim();
	const value = Number(text);
	if (text === "" || !Number.isFinite(value)) {
		throw new Error("must be a number");
	}
	return value;
}

function parseInteger(raw: string): number {
	const text = raw.trim();
	const value = Number(text);
	if (text === "" || !Number.isSafeInteger(value)) {
		throw new Error("must be an integer");
	}
	return value;
}

const TRUE_WORDS = new Set(["true", "1", "yes", "on"]);
const FALSE_WORDS = new Set(["false", "0", "no", "off"]);

/** Any non-empty string. */
export const str = validator((raw) => raw);

/** A finite number, e.g. `0.25`. */
export const num = validator(parseNumber);

/** A whole number, e.g. `42`. */
export const int = validator(parseInteger);

/** A TCP port: an integer from 1 to 65535. */
export const port = validator((raw) => {
	const value = parseInteger(raw);
	if (value < 1 || value > 65535) {
		throw new Error("must be a port between 1 and 65535");
	}
	return value;
});

/** `true`/`false`, also accepting `1`/`0`, `yes`/`no` and `on`/`off`. */
export const bool = validator((raw) => {
	const word = raw.trim().toLowerCase();
	if (TRUE_WORDS.has(word)) return true;
	if (FALSE_WORDS.has(word)) return false;
	throw new Error("must be true or false");
});

/** An absolute URL, returned as the original string. */
export const url = validator((raw) => {
	if (!URL.canParse(raw)) {
		throw new Error("must be a valid URL");
	}
	return raw;
});

type Choices = readonly [string, ...string[]];

/** One of a fixed list of strings, typed as their union. */
export function oneOf<const T extends Choices>(values: T): Spec<T[number]>;
export function oneOf<const T extends Choices>(
	values: T,
	options: { readonly default: T[number] },
): Spec<T[number]>;
export function oneOf<const T extends Choices>(
	values: T,
	options: { readonly optional: true },
): Spec<T[number] | undefined>;
export function oneOf(
	values: readonly string[],
	options: SpecOptions<string> = {},
): Spec<string | undefined> {
	const parse = (raw: string): string => {
		if (!values.includes(raw)) {
			throw new Error(`must be one of: ${values.join(", ")}`);
		}
		return raw;
	};
	return makeSpec(parse, options);
}

export type Schema = Record<string, Spec<unknown>>;

/** The object type `loadEnv` returns for a given schema. */
export type Env<S extends Schema> = {
	readonly [K in keyof S]: S[K] extends Spec<infer T> ? T : never;
};

export interface EnvIssue {
	readonly key: string;
	readonly message: string;
}

/** Thrown by `loadEnv`, listing every variable that is missing or invalid. */
export class EnvError extends Error {
	readonly issues: readonly EnvIssue[];

	constructor(issues: readonly EnvIssue[]) {
		const lines = issues.map((issue) => `  ${issue.key} ${issue.message}`);
		super(["Invalid environment variables:", ...lines].join("\n"));
		this.name = "EnvError";
		this.issues = issues;
	}
}

/**
 * Reads and validates the variables described by `schema`.
 *
 * Returns a frozen object typed from the schema, or throws one `EnvError`
 * covering all problems at once. Unset and empty variables are treated the
 * same. Error messages never include the values, since they may be secrets.
 */
export function loadEnv<S extends Schema>(
	schema: S,
	source: Record<string, string | undefined> = process.env,
): Env<S> {
	const result: Record<string, unknown> = {};
	const issues: EnvIssue[] = [];

	for (const [key, spec] of Object.entries(schema)) {
		const raw = source[key];

		if (raw === undefined || raw === "") {
			if (spec.fallback) {
				result[key] = spec.fallback.value;
			} else if (spec.optional) {
				result[key] = undefined;
			} else {
				issues.push({ key, message: "is required but not set" });
			}
			continue;
		}

		try {
			result[key] = spec.parse(raw);
		} catch (error) {
			const message = error instanceof Error ? error.message : "is invalid";
			issues.push({ key, message });
		}
	}

	if (issues.length > 0) {
		throw new EnvError(issues);
	}
	return Object.freeze(result) as Env<S>;
}
