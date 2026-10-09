# ask_user — a Pi extension

A small [Pi](https://pi.dev) extension that registers a single **`ask_user`** tool.
It lets the agent pause and ask the human to resolve a decision it cannot make
alone, presenting selectable options and (optionally) a free-form answer.

The extension is deliberately dependency-free: it is plain TypeScript with no
runtime or type dependencies, so Pi can load it directly through `jiti` with no
build step.

## Features

- **Selectable options** — the human picks one of the provided options.
- **Free-form answers** — when allowed (the default), the human can type an
  answer that is not in the list.
- **Option values** — an option may return a separate `value` instead of its
  display `label`.
- **Safe non-answers** — cancellation, an empty answer, unavailable UI, and
  invalid input are reported distinctly and are **never** treated as approval.
- **Tolerant argument handling** — a `prepareArguments` shim normalizes the
  `options` array if a model serializes it as a JSON string or sends a single
  option object. The declared interface stays array-based.
- **Tested** — the interaction logic and the registered tool are covered by
  Node's built-in test runner (22 tests).

## Requirements

- **Node.js** with type stripping (`--experimental-strip-types`). Node 22.6+;
  tested on Node v26.10.0.
- **Pi** to actually load and use the tool.
- No npm packages to install.

## Installation

### Option A — install as a Pi package (recommended)

This repository is already a Pi package: `package.json` declares the extension
under the `pi` key.

```bash
pi install ./ask-user-pi-extension        # local checkout
# or, when published to npm / git:
pi install npm:ask-user-pi-extension
pi install git:github.com/<owner>/ask-user-pi-extension
```

`pi install --local` writes the declaration to `.pi/settings.json` instead of
the personal settings file.

### Option B — copy it into an extensions directory

Pi loads direct `.ts`/`.js` files and directories containing an `index.ts` or
`index.js` entry point.

```bash
# personal (all projects)
mkdir -p ~/.pi/agent/extensions/ask-user
cp src/*.ts ~/.pi/agent/extensions/ask-user/

# project-local (loaded after project trust)
mkdir -p .pi/extensions/ask-user
cp src/*.ts .pi/extensions/ask-user/
```

## Loading

- **Try it for one run** (no install):

  ```bash
  pi --extension ./src/index.ts
  # or the short form
  pi -e ./src/index.ts
  ```

- **Personal / project**: place the files under
  `~/.pi/agent/extensions/` or `.pi/extensions/` as shown above.

- **Package**: the `pi.extensions` field in `package.json` points at
  `./src/index.ts`, so no extra configuration is needed once installed.

## Usage

Once loaded, the model can call the `ask_user` tool. The parameters are:

| Parameter     | Type      | Required | Description                                                                                       |
| ------------- | --------- | -------- | ------------------------------------------------------------------------------------------------- |
| `question`    | `string`  | yes      | The question to ask the human.                                                                    |
| `options`     | `object[]`| yes      | Selectable answers. Each item has `label` (required) and optional `value` / `description`. An empty array means a free-form answer is required. |
| `allowCustom` | `boolean` | no       | When `true` (default), the human may type an answer that is not in the options.                    |

> **`options` must be a real array**, for example
> `[{"label":"Yes"},{"label":"No"}]` — not a JSON-encoded string. The
> extension's `prepareArguments` hook recovers a stringified array as a safety
> net, but callers should always pass an array.

Example call:

```json
{
  "question": "Which storage approach should we use?",
  "options": [
    { "label": "SQLite", "description": "Persistent and queryable" },
    { "label": "JSON file", "value": "json" },
    { "label": "In-memory", "description": "Lost on restart" }
  ],
  "allowCustom": true
}
```

### Result statuses

The tool returns model-facing text plus structured `details`. `details.status`
is one of:

| Status        | Meaning                                                        | Treated as approval? |
| ------------- | -------------------------------------------------------------- | -------------------- |
| `selected`    | The human picked one of the options.                           | yes                  |
| `custom`      | The human typed a free-form answer.                            | yes                  |
| `cancelled`   | The human dismissed the question.                              | **no**               |
| `empty`       | The human submitted a blank answer.                            | **no**               |
| `unavailable` | No interactive UI (e.g. JSON/print mode).                      | **no**               |
| `invalid`     | The parameters were invalid, so nothing was asked.             | **no**               |

For every non-answer, the returned text explicitly states that it is not an
answer and must not be treated as approval.

## Testing

The suite uses Node's built-in test runner and type stripping, so it runs with
no install:

```bash
npm test          # run the full suite once
npm run test:watch
```

Current result: **22 tests, 22 passing** (Node v26.10.0).

Coverage includes:

1. Selecting one of the provided options (including custom `value`s and
   `allowCustom: false`).
2. Entering a trimmed free-form answer, including the no-options case.
3. Cancellation and empty responses (never treated as approval).
4. Interactive UI being unavailable (the UI is never touched).
5. Validation and safety: empty questions, `allowCustom: false` with no
   options, unexpected UI selections, and non-approval messaging.
6. Argument normalization: stringified `options`, a single option object, valid
   arrays left untouched, and unrecoverable input left for schema validation.

## Project layout

```text
src/ask-user.ts        pure interaction logic, validation, and result shaping
src/tool.ts            Pi tool definition, JSON Schema, prepareArguments shim
src/index.ts           extension entry point (registerTool)
test/ask-user.test.ts  tests exercised through the real tool execute path
types/node-shims.d.ts  minimal Node typings so the repo stays dependency-free
```

## Design notes

- **No dependencies.** Pi loads the TypeScript directly via `jiti`; the project
  needs no `tsc`, bundler, or `@types/node`.
- **Plain JSON Schema.** Pi's validator accepts a schema without a TypeBox kind
  and applies JSON-Schema coercion, so the tool avoids a `typebox` import.
- **`prepareArguments`.** Pi runs this hook before schema validation. It mirrors
  the built-in `edit` tool, which parses a stringified `edits` array the same
  way.
- **Structural types.** Each module declares only the small slice of the Pi API
  it uses, keeping the extension portable.

## Known limitations

- `execute()` does not actively check the abort signal; dialog cancellation is
  handled by Pi's UI layer.
- The shared `parameters` object is not frozen.
- `tsc --noEmit` is not runnable without installing TypeScript; correctness is
  checked by the Node test suite instead.
