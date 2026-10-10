import { describe, expect, expectTypeOf, it } from "vitest";
import {
	bool,
	EnvError,
	int,
	loadEnv,
	num,
	oneOf,
	port,
	str,
	url,
	validator,
} from "../src/index.ts";

function issuesOf(run: () => unknown) {
	try {
		run();
	} catch (error) {
		if (error instanceof EnvError) return error.issues;
		throw error;
	}
	throw new Error("expected loadEnv to throw");
}

describe("loadEnv", () => {
	it("parses each variable into its declared type", () => {
		const env = loadEnv(
			{
				NAME: str(),
				RATIO: num(),
				WORKERS: int(),
				PORT: port(),
				DEBUG: bool(),
				API_URL: url(),
				MODE: oneOf(["development", "production"]),
			},
			{
				NAME: "api",
				RATIO: "0.25",
				WORKERS: "4",
				PORT: "8080",
				DEBUG: "yes",
				API_URL: "https://example.com/v1",
				MODE: "production",
			},
		);

		expect(env).toEqual({
			NAME: "api",
			RATIO: 0.25,
			WORKERS: 4,
			PORT: 8080,
			DEBUG: true,
			API_URL: "https://example.com/v1",
			MODE: "production",
		});
	});

	it("infers the result type from the schema", () => {
		const env = loadEnv(
			{
				PORT: port({ default: 3000 }),
				DEBUG: bool({ default: false }),
				API_URL: url(),
				MODE: oneOf(["development", "production"]),
				SENTRY_DSN: str({ optional: true }),
				LEVEL: oneOf(["info", "warn"], { optional: true }),
			},
			{ API_URL: "https://example.com", MODE: "development" },
		);

		expectTypeOf(env).toEqualTypeOf<{
			readonly PORT: number;
			readonly DEBUG: boolean;
			readonly API_URL: string;
			readonly MODE: "development" | "production";
			readonly SENTRY_DSN: string | undefined;
			readonly LEVEL: "info" | "warn" | undefined;
		}>();
	});

	it("rejects options of the wrong type at compile time", () => {
		// @ts-expect-error a number validator cannot default to a string
		int({ default: "3000" });
		// @ts-expect-error the default must be one of the choices
		oneOf(["a", "b"], { default: "c" });
		// @ts-expect-error unknown keys are not on the result
		loadEnv({ A: str({ default: "x" }) }, {}).B;
	});

	it("uses defaults and undefined for unset or empty variables", () => {
		const env = loadEnv(
			{
				PORT: port({ default: 3000 }),
				DEBUG: bool({ default: false }),
				SENTRY_DSN: str({ optional: true }),
				MODE: oneOf(["a", "b"], { default: "b" }),
			},
			{ PORT: "", DEBUG: undefined },
		);

		expect(env).toEqual({
			PORT: 3000,
			DEBUG: false,
			SENTRY_DSN: undefined,
			MODE: "b",
		});
	});

	it("prefers a set value over the default", () => {
		const env = loadEnv({ PORT: port({ default: 3000 }) }, { PORT: "9000" });
		expect(env.PORT).toBe(9000);
	});

	it("reports every problem in one error", () => {
		const run = () =>
			loadEnv(
				{ PORT: port(), DEBUG: bool(), API_URL: url(), NAME: str() },
				{ PORT: "70000", DEBUG: "maybe", NAME: "api" },
			);

		expect(issuesOf(run)).toEqual([
			{ key: "PORT", message: "must be a port between 1 and 65535" },
			{ key: "DEBUG", message: "must be true or false" },
			{ key: "API_URL", message: "is required but not set" },
		]);
		expect(run).toThrow(
			[
				"Invalid environment variables:",
				"  PORT must be a port between 1 and 65535",
				"  DEBUG must be true or false",
				"  API_URL is required but not set",
			].join("\n"),
		);
	});

	it("never puts values in error messages", () => {
		const run = () => loadEnv({ TOKEN: int() }, { TOKEN: "s3cret-value" });
		expect(run).toThrow(EnvError);
		expect(run).not.toThrow(/s3cret-value/);
	});

	it("returns a frozen object", () => {
		const env = loadEnv({ NAME: str() }, { NAME: "api" });
		expect(Object.isFrozen(env)).toBe(true);
	});

	it("ignores variables that are not in the schema", () => {
		const env = loadEnv({ NAME: str() }, { NAME: "api", OTHER: "x" });
		expect(env).toEqual({ NAME: "api" });
	});

	it("reads process.env by default", () => {
		process.env.TYPED_ENV_TEST_VALUE = "41";
		try {
			expect(
				loadEnv({ TYPED_ENV_TEST_VALUE: int() }).TYPED_ENV_TEST_VALUE,
			).toBe(41);
		} finally {
			delete process.env.TYPED_ENV_TEST_VALUE;
		}
	});
});

describe("validators", () => {
	const parse = <T>(spec: { parse: (raw: string) => T }, raw: string) =>
		spec.parse(raw);

	it("num accepts finite numbers only", () => {
		expect(parse(num(), "1.5")).toBe(1.5);
		expect(parse(num(), " -2 ")).toBe(-2);
		expect(parse(num(), "1e3")).toBe(1000);
		for (const bad of ["abc", "1.2.3", "Infinity", "NaN", "  "]) {
			expect(() => parse(num(), bad)).toThrow("must be a number");
		}
	});

	it("int rejects fractions and unsafe integers", () => {
		expect(parse(int(), "42")).toBe(42);
		expect(parse(int(), "-7")).toBe(-7);
		for (const bad of ["1.5", "abc", "9007199254740993", " "]) {
			expect(() => parse(int(), bad)).toThrow("must be an integer");
		}
	});

	it("port enforces the valid range", () => {
		expect(parse(port(), "1")).toBe(1);
		expect(parse(port(), "65535")).toBe(65535);
		for (const bad of ["0", "65536", "-1"]) {
			expect(() => parse(port(), bad)).toThrow(
				"must be a port between 1 and 65535",
			);
		}
		expect(() => parse(port(), "http")).toThrow("must be an integer");
	});

	it("bool accepts common spellings, case-insensitively", () => {
		for (const yes of ["true", "TRUE", "1", "yes", "On", " true "]) {
			expect(parse(bool(), yes)).toBe(true);
		}
		for (const no of ["false", "False", "0", "no", "OFF"]) {
			expect(parse(bool(), no)).toBe(false);
		}
		expect(() => parse(bool(), "2")).toThrow("must be true or false");
	});

	it("url requires an absolute URL and keeps the original string", () => {
		expect(parse(url(), "postgres://db:5432/app")).toBe(
			"postgres://db:5432/app",
		);
		expect(() => parse(url(), "example.com")).toThrow("must be a valid URL");
	});

	it("oneOf lists the allowed values when it fails", () => {
		const mode = oneOf(["development", "production"]);
		expect(parse(mode, "production")).toBe("production");
		expect(() => parse(mode, "Production")).toThrow(
			"must be one of: development, production",
		);
	});

	it("validator builds custom validators with the same options", () => {
		const list = validator((raw) => raw.split(",").map((item) => item.trim()));
		const env = loadEnv(
			{
				HOSTS: list(),
				TAGS: list({ default: [] }),
				EXTRA: list({ optional: true }),
			},
			{ HOSTS: "a, b" },
		);

		expect(env).toEqual({ HOSTS: ["a", "b"], TAGS: [], EXTRA: undefined });
		expectTypeOf(env).toEqualTypeOf<{
			readonly HOSTS: string[];
			readonly TAGS: string[];
			readonly EXTRA: string[] | undefined;
		}>();
	});

	it("reports non-Error throws from custom validators generically", () => {
		const broken = validator((): string => {
			throw "boom";
		});
		expect(issuesOf(() => loadEnv({ X: broken() }, { X: "1" }))).toEqual([
			{ key: "X", message: "is invalid" },
		]);
	});
});
