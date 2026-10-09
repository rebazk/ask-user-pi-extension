/**
 * Tests for the ask_user tool.
 *
 * These tests exercise the real tool execution path (buildAskUserTool().execute)
 * with mock UI implementations, covering the four required interaction cases:
 *   1. selecting one of the provided options
 *   2. entering a custom answer
 *   3. cancellation / empty responses
 *   4. interactive UI being unavailable
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CUSTOM_ANSWER_LABEL, type AskUserParams, type AskUserUI } from "../src/ask-user.ts";
import { buildAskUserTool, prepareAskUserArguments, type AskUserToolContext } from "../src/tool.ts";

type RecordedCall =
	| { kind: "select"; title: string; options: string[] }
	| { kind: "input"; title: string; placeholder: string | undefined };

interface MockUI {
	ui: AskUserUI;
	calls: RecordedCall[];
}

/** Build a mock UI whose dialogs record their calls and return scripted values. */
function mockUI(script: {
	select?: (title: string, options: string[]) => string | undefined | Promise<string | undefined>;
	input?: (title: string, placeholder: string | undefined) => string | undefined | Promise<string | undefined>;
} = {}): MockUI {
	const calls: RecordedCall[] = [];
	const ui: AskUserUI = {
		async select(title, options) {
			calls.push({ kind: "select", title, options });
			return script.select ? script.select(title, options) : undefined;
		},
		async input(title, placeholder) {
			calls.push({ kind: "input", title, placeholder });
			return script.input ? script.input(title, placeholder) : undefined;
		},
	};
	return { ui, calls };
}

function ctxWith(ui: AskUserUI): AskUserToolContext {
	return { hasUI: true, ui };
}

/** Context where an interactive UI exists but must never be touched. */
function ctxWithoutUI(ui: AskUserUI): AskUserToolContext {
	return { hasUI: false, ui };
}

const tool = buildAskUserTool();

async function run(params: AskUserParams, ctx: AskUserToolContext) {
	return tool.execute("call-1", params, undefined, undefined, ctx);
}

function firstText(result: { content: { type: "text"; text: string }[] }): string {
	const first = result.content[0];
	assert.equal(first.type, "text");
	return first.text;
}

test("tool registration exposes the expected contract", () => {
	assert.equal(tool.name, "ask_user");
	assert.equal(tool.executionMode, "sequential");
	assert.equal(typeof tool.description, "string");
	assert.ok(tool.description.length > 0);
	assert.equal(typeof tool.parameters, "object");
	assert.equal(Array.isArray(tool.parameters), false);
	assert.equal((tool.parameters as { required?: string[] }).required?.includes("question"), true);
	assert.equal((tool.parameters as { required?: string[] }).required?.includes("options"), true);
	assert.equal(typeof tool.prepareArguments, "function");
	const properties = (tool.parameters as { properties?: Record<string, { type?: unknown }> }).properties;
	assert.equal(properties?.options?.type, "array");
});

// --- Argument normalization (stringified options) ---------------------------

test("prepareArguments parses a JSON-encoded options string", () => {
	const prepared = prepareAskUserArguments({
		question: "Pick one",
		options: '[{"label":"Alpha"},{"label":"Beta"}]',
	});

	assert.deepEqual(prepared.options, [{ label: "Alpha" }, { label: "Beta" }]);
});

test("prepareArguments wraps a single option object", () => {
	const prepared = prepareAskUserArguments({ question: "Pick one", options: { label: "Only" } });

	assert.deepEqual(prepared.options, [{ label: "Only" }]);
});

test("prepareArguments leaves a valid array unchanged", () => {
	const options = [{ label: "Alpha" }, { label: "Beta" }];
	const prepared = prepareAskUserArguments({ question: "Pick one", options });

	assert.equal(prepared.options, options);
});

test("prepareArguments leaves an unrecoverable value for schema validation", () => {
	const prepared = prepareAskUserArguments({ question: "Pick one", options: "not json" });

	assert.equal(prepared.options, "not json");
});

test("a stringified options array still allows selecting an option", async () => {
	const prepared = prepareAskUserArguments({
		question: "Pick one",
		options: '[{"label":"Alpha"},{"label":"Beta"}]',
	});
	const { ui } = mockUI({ select: (_title, options) => options[1] });

	const result = await run(prepared, ctxWith(ui));

	assert.equal(result.details.status, "selected");
	assert.equal(result.details.answer, "Beta");
});

// --- Case 1: selecting one of the provided options -------------------------

test("case 1: returns the selected option", async () => {
	const params: AskUserParams = {
		question: "Which database should we use?",
		options: [
			{ label: "PostgreSQL" },
			{ label: "SQLite" },
			{ label: "DuckDB" },
		],
	};
	const { ui, calls } = mockUI({ select: (_title, options) => options[1] });

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "selected");
	assert.equal(result.details.answer, "SQLite");
	assert.equal(result.details.wasCustom, false);
	assert.deepEqual(result.details.options, ["PostgreSQL", "SQLite", "DuckDB"]);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.kind, "select");
	assert.equal((calls[0] as { options: string[] }).options.length, 4); // 3 options + custom entry
	assert.match(firstText(result), /SQLite/);
});

test("case 1: returns the option's value when one is provided", async () => {
	const params: AskUserParams = {
		question: "Pick a transport",
		options: [
			{ label: "Secure shell", value: "ssh" },
			{ label: "Local terminal", value: "local" },
		],
	};
	const { ui } = mockUI({ select: (_title, options) => options[0] });

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "selected");
	assert.equal(result.details.answer, "ssh");
	assert.equal(result.details.wasCustom, false);
});

test("case 1: does not offer a custom entry when allowCustom is false", async () => {
	const params: AskUserParams = {
		question: "Continue?",
		options: [{ label: "Yes" }, { label: "No" }],
		allowCustom: false,
	};
	const { ui, calls } = mockUI({ select: (_title, options) => options[1] });

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "selected");
	assert.equal(result.details.answer, "No");
	const selectCall = calls[0] as { options: string[] };
	assert.deepEqual(selectCall.options, ["Yes", "No"]);
});

// --- Case 2: entering a custom answer ---------------------------------------

test("case 2: uses the typed custom answer", async () => {
	const params: AskUserParams = {
		question: "Which database should we use?",
		options: [{ label: "PostgreSQL" }, { label: "SQLite" }],
	};
	const { ui, calls } = mockUI({
		select: (_title, options) => options[options.length - 1],
		input: () => "CockroachDB",
	});

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "custom");
	assert.equal(result.details.answer, "CockroachDB");
	assert.equal(result.details.wasCustom, true);
	assert.equal(calls.length, 2);
	assert.equal(calls[1]?.kind, "input");
	assert.match(firstText(result), /CockroachDB/);
});

test("case 2: trims whitespace around a custom answer", async () => {
	const params: AskUserParams = { question: "Name?", options: [{ label: "Anonymous" }] };
	const { ui } = mockUI({
		select: (_title, options) => options[options.length - 1],
		input: () => "   Ada Lovelace   ",
	});

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "custom");
	assert.equal(result.details.answer, "Ada Lovelace");
});

test("case 2: with no options, allowCustom asks for free-form input directly", async () => {
	const params: AskUserParams = { question: "What should we name it?", options: [] };
	const { ui, calls } = mockUI({ input: () => "Project Falcon" });

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "custom");
	assert.equal(result.details.answer, "Project Falcon");
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.kind, "input");
});

// --- Case 3: cancellation and empty responses -------------------------------

test("case 3: select cancellation is reported and never treated as approval", async () => {
	const params: AskUserParams = {
		question: "Delete the production database?",
		options: [{ label: "Yes" }, { label: "No" }],
	};
	const { ui, calls } = mockUI({ select: () => undefined });

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "cancelled");
	assert.equal(result.details.answer, null);
	assert.equal(result.details.wasCustom, false);
	assert.equal(calls.length, 1);
	const text = firstText(result);
	assert.match(text, /cancel/i);
	assert.match(text, /not.+approv/i);
});

test("case 3: cancelling the custom input is treated as cancellation", async () => {
	const params: AskUserParams = { question: "Name?", options: [{ label: "Anonymous" }] };
	const { ui } = mockUI({
		select: (_title, options) => options[options.length - 1],
		input: () => undefined,
	});

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "cancelled");
	assert.equal(result.details.answer, null);
	assert.match(firstText(result), /not.+approv/i);
});

test("case 3: an empty custom answer is reported and never treated as approval", async () => {
	const params: AskUserParams = { question: "Name?", options: [{ label: "Anonymous" }] };
	const { ui, calls } = mockUI({
		select: (_title, options) => options[options.length - 1],
		input: () => "   ",
	});

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "empty");
	assert.equal(result.details.answer, null);
	assert.equal(result.details.wasCustom, false);
	assert.equal(calls.length, 2);
	const text = firstText(result);
	assert.match(text, /empty/i);
	assert.match(text, /not.+approv/i);
});

test("case 3: cancellation after choosing the custom entry is safe", async () => {
	const params: AskUserParams = { question: "Name?", options: [{ label: "Anonymous" }] };
	const { ui } = mockUI({
		select: (_title, options) => options[options.length - 1],
		input: () => undefined,
	});

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "cancelled");
	assert.equal(result.details.answer, null);
});

// --- Case 4: interactive UI unavailable -------------------------------------

test("case 4: unavailable UI returns a safe non-answer and does not touch the UI", async () => {
	let touched = false;
	const ui: AskUserUI = {
		async select() {
			touched = true;
			return "Yes";
		},
		async input() {
			touched = true;
			return "should not happen";
		},
	};
	const params: AskUserParams = {
		question: "Delete the production database?",
		options: [{ label: "Yes" }, { label: "No" }],
	};

	const result = await run(params, ctxWithoutUI(ui));

	assert.equal(result.details.status, "unavailable");
	assert.equal(result.details.answer, null);
	assert.equal(result.details.wasCustom, false);
	assert.equal(touched, false);
	const text = firstText(result);
	assert.match(text, /not available|unavailable/i);
	assert.match(text, /not.+approv/i);
});

test("case 4: missing UI object is handled as unavailable", async () => {
	const result = await run(
		{ question: "Proceed?", options: [{ label: "Yes" }] },
		{ hasUI: true, ui: undefined as unknown as AskUserUI },
	);

	assert.equal(result.details.status, "unavailable");
	assert.equal(result.details.answer, null);
});

// --- Additional safety / validation cases -----------------------------------

test("an empty question is rejected without touching the UI", async () => {
	let touched = false;
	const ui: AskUserUI = {
		async select() {
			touched = true;
			return "Yes";
		},
		async input() {
			touched = true;
			return "x";
		},
	};

	const result = await run({ question: "   ", options: [{ label: "Yes" }] }, ctxWith(ui));

	assert.equal(result.details.status, "invalid");
	assert.equal(result.details.answer, null);
	assert.equal(touched, false);
	assert.match(firstText(result), /question/i);
});

test("no options and allowCustom false is rejected without touching the UI", async () => {
	let touched = false;
	const ui: AskUserUI = {
		async select() {
			touched = true;
			return "Yes";
		},
		async input() {
			touched = true;
			return "x";
		},
	};

	const result = await run(
		{ question: "Pick one", options: [], allowCustom: false },
		ctxWith(ui),
	);

	assert.equal(result.details.status, "invalid");
	assert.equal(result.details.answer, null);
	assert.equal(touched, false);
});

test("an unexpected selection is rejected when custom answers are disabled", async () => {
	const params: AskUserParams = {
		question: "Pick one",
		options: [{ label: "Alpha" }, { label: "Beta" }],
		allowCustom: false,
	};
	const { ui } = mockUI({ select: () => "Gamma" });

	const result = await run(params, ctxWith(ui));

	assert.equal(result.details.status, "invalid");
	assert.equal(result.details.answer, null);
	assert.equal(result.details.wasCustom, false);
});

test("the custom entry label is distinct from normal options", () => {
	assert.equal(typeof CUSTOM_ANSWER_LABEL, "string");
	assert.ok(CUSTOM_ANSWER_LABEL.length > 0);
});
