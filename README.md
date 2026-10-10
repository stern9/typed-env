# typed-env

[![CI](https://github.com/stern9/typed-env/actions/workflows/ci.yml/badge.svg)](https://github.com/stern9/typed-env/actions/workflows/ci.yml)

Validate environment variables against a schema and get back a fully typed
config object. Zero dependencies, one small file.

```ts
import { bool, loadEnv, oneOf, port, str, url } from "@stern9/typed-env";

export const env = loadEnv({
  PORT: port({ default: 3000 }),
  DEBUG: bool({ default: false }),
  DATABASE_URL: url(),
  NODE_ENV: oneOf(["development", "production", "test"]),
  SENTRY_DSN: str({ optional: true }),
});
```

The type of `env` is inferred from the schema, with no annotations:

```ts
{
  readonly PORT: number;
  readonly DEBUG: boolean;
  readonly DATABASE_URL: string;
  readonly NODE_ENV: "development" | "production" | "test";
  readonly SENTRY_DSN: string | undefined;
}
```

If anything is missing or malformed, `loadEnv` throws a single `EnvError`
listing every problem, so you fix them all in one go:

```text
EnvError: Invalid environment variables:
  PORT must be an integer
  DATABASE_URL is required but not set
  NODE_ENV must be one of: development, production, test
```

## Install

Not on npm yet. The library is a single file with no dependencies, so you can
copy [`src/index.ts`](src/index.ts) into your project, or build it locally:

```sh
git clone https://github.com/stern9/typed-env
cd typed-env
pnpm install
pnpm run build
```

## Validators

| Validator       | Accepts                                           | Type            |
| --------------- | ------------------------------------------------- | --------------- |
| `str()`         | any non-empty string                              | `string`        |
| `num()`         | a finite number                                   | `number`        |
| `int()`         | a whole number                                    | `number`        |
| `port()`        | an integer from 1 to 65535                        | `number`        |
| `bool()`        | `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`   | `boolean`       |
| `url()`         | an absolute URL                                   | `string`        |
| `oneOf([...])`  | one of the listed strings                         | union of them   |

Every validator takes the same options:

- no options: the variable is required
- `{ default: value }`: used when the variable is unset
- `{ optional: true }`: the result may be `undefined`

Write your own with `validator`. Return the parsed value, or throw an `Error`
whose message completes the sentence "KEY ...":

```ts
import { loadEnv, validator } from "@stern9/typed-env";

const list = validator((raw) => raw.split(",").map((item) => item.trim()));

const env = loadEnv({ ALLOWED_HOSTS: list({ default: [] }) });
// env.ALLOWED_HOSTS: string[]
```

## Good to know

- An empty variable (`PORT=`) is treated the same as an unset one.
- Error messages never include the values, since they may be secrets.
- The returned object is frozen.
- `loadEnv` reads `process.env` by default; pass any object as the second
  argument to read from somewhere else, which is handy in tests.
- `EnvError.issues` holds the problems as `{ key, message }` objects.

## Development

```sh
pnpm run check   # lint, typecheck, test, build
```

## License

[MIT](LICENSE)
