/**
 * Tool definition for ask_user.
 *
 * The parameter schema is a plain JSON Schema object and the Pi types are
 * described structurally, so this file has no runtime or type dependencies and
 * the extension can be loaded or tested without installing anything.
 */

import { askUser, type AskUserParams, type AskUserResult, type AskUserUI } from "./ask-user.ts";

/** Minimal structural view of the Pi ExtensionContext used by this tool. */
export interface AskUserToolContext {
	hasUI: boolean;
	ui?: AskUserUI;
}

/** Minimal structural view of a Pi ToolDefinition. */
export interface AskUserToolDefinition {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: Record<string, unknown>;
	/** Compatibility shim that normalizes raw tool arguments before schema validation. */
	prepareArguments?(args: unknown): AskUserParams;
	executionMode: "sequential";
	execute(
		toolCallId: string,
		params: AskUserParams,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: AskUserToolContext,
	): Promise<AskUserResult>;
}

const parameters: Record<string, unknown> = {
	type: "object",
	properties: {
		question: {
			type: "string",
			description: "The question to ask the human. Be specific about the unresolved decision.",
		},
		options: {
			type: "array",
			description:
				"Selectable answers as a JSON array of objects, e.g. " +
				'[{"label":"Alpha"},{"label":"Beta"}]. Pass a real array, never a JSON-encoded string. ' +
				"Use an empty array to require a free-form answer.",
			items: {
				type: "object",
				properties: {
					label: { type: "string", description: "Short display text for the option." },
					value: { type: "string", description: "Value returned when selected. Defaults to the label." },
					description: {
						type: "string",
						description: "Optional longer explanation shown under the label.",
					},
				},
				required: ["label"],
				additionalProperties: false,
			},
		},
		allowCustom: {
			type: "boolean",
			description: "When true (default), the human may type an answer that is not in the options.",
		},
	},
	required: ["question", "options"],
	additionalProperties: false,
};

/** Normalize a parsed `options` value into an array when possible. */
function optionsFromParsedValue(parsed: unknown): AskUserOption[] | undefined {
	if (Array.isArray(parsed)) {
		return parsed as AskUserOption[];
	}
	if (parsed && typeof parsed === "object" && typeof (parsed as { label?: unknown }).label === "string") {
		return [parsed as AskUserOption];
	}
	return undefined;
}

/**
 * Compatibility shim that runs before schema validation.
 *
 * Some models occasionally serialize the `options` array as a JSON string (or
 * send a single option object instead of an array). Pi's JSON-Schema coercion
 * cannot turn a string into an array, so normalize those shapes here. This
 * mirrors the built-in `edit` tool, which does the same for a stringified
 * `edits` argument. The declared interface remains array-based: input that
 * cannot be recovered is returned unchanged so schema validation reports it.
 */
export function prepareAskUserArguments(args: unknown): AskUserParams {
	if (!args || typeof args !== "object" || Array.isArray(args)) {
		return args as AskUserParams;
	}
	const { options } = args as Record<string, unknown>;

	if (typeof options === "string") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(options);
		} catch {
			return args as AskUserParams;
		}
		const normalized = optionsFromParsedValue(parsed);
		return normalized ? { ...(args as AskUserParams), options: normalized } : (args as AskUserParams);
	}

	if (options && typeof options === "object" && !Array.isArray(options)) {
		const normalized = optionsFromParsedValue(options);
		return normalized ? { ...(args as AskUserParams), options: normalized } : (args as AskUserParams);
	}

	return args as AskUserParams;
}

/** Build the ask_user tool definition. */
export function buildAskUserTool(): AskUserToolDefinition {
	return {
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the human a question when an important decision is unresolved and their input is required to " +
			"continue. Presents selectable options and also allows a free-form answer.",
		promptSnippet: "ask_user: ask the human to resolve an important decision you cannot decide alone",
		promptGuidelines: [
			"Use ask_user when an important decision is unresolved and only the human can resolve it.",
			'Pass ask_user options as an array of objects (e.g. [{"label":"Yes"},{"label":"No"}]), never as a JSON-encoded string.',
			"If ask_user reports cancellation, an empty answer, or unavailable UI, that is not an answer and not approval. " +
				"Do not proceed with the decision-dependent action; ask again, choose only a safe independent step, or stop and report the blocker.",
		],
		parameters,
		prepareArguments: prepareAskUserArguments,

		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const ui = ctx?.hasUI ? ctx.ui : undefined;
			return askUser(params, ui);
		},
	};
}
