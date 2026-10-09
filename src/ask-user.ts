/**
 * Pure core logic for the ask_user tool.
 *
 * This module has no runtime dependencies so it can be unit tested directly and
 * loaded anywhere. It receives a minimal UI adapter instead of a Pi context,
 * which keeps the interaction logic independent from the terminal UI.
 */

export interface AskUserOption {
	/** Short display text for the option. */
	label: string;
	/** Value returned when the option is selected. Defaults to the label. */
	value?: string;
	/** Optional longer explanation shown under the label. */
	description?: string;
}

export interface AskUserParams {
	/** The question to ask the human. */
	question: string;
	/** Selectable answers. May be empty to require a free-form answer. */
	options: AskUserOption[];
	/** When true (default), the human may type an answer not in the options. */
	allowCustom?: boolean;
}

/** Minimal interactive UI surface used by {@link askUser}. */
export interface AskUserUI {
	select(title: string, options: string[]): Promise<string | undefined>;
	input(title: string, placeholder?: string): Promise<string | undefined>;
}

export type AskUserStatus =
	| "selected"
	| "custom"
	| "cancelled"
	| "empty"
	| "unavailable"
	| "invalid";

export interface AskUserDetails {
	question: string;
	options: string[];
	answer: string | null;
	wasCustom: boolean;
	status: AskUserStatus;
}

export interface AskUserResult {
	content: { type: "text"; text: string }[];
	details: AskUserDetails;
}

/** Label of the synthetic option that switches to free-form input. */
export const CUSTOM_ANSWER_LABEL = "✎ Type your own answer…";

const NOT_APPROVAL =
	"This is not an answer and must not be treated as approval. Do not proceed with the " +
	"decision-dependent action; ask again, choose only a safe independent step, or stop and report the blocker.";

function result(text: string, details: AskUserDetails): AskUserResult {
	return { content: [{ type: "text", text }], details };
}

function details(
	question: string,
	options: string[],
	answer: string | null,
	wasCustom: boolean,
	status: AskUserStatus,
): AskUserDetails {
	return { question, options, answer, wasCustom, status };
}

function selectedResult(question: string, options: string[], answer: string): AskUserResult {
	return result(`The user selected: "${answer}".`, details(question, options, answer, false, "selected"));
}

function customResult(question: string, options: string[], answer: string): AskUserResult {
	return result(`The user provided a custom answer: "${answer}".`, details(question, options, answer, true, "custom"));
}

function cancelledResult(question: string, options: string[]): AskUserResult {
	return result(`The user cancelled the question without answering. ${NOT_APPROVAL}`, details(question, options, null, false, "cancelled"));
}

function emptyResult(question: string, options: string[]): AskUserResult {
	return result(`The user submitted an empty answer. ${NOT_APPROVAL}`, details(question, options, null, false, "empty"));
}

function unavailableResult(question: string, options: string[]): AskUserResult {
	return result(
		`ask_user could not run: interactive UI is not available in this mode. ${NOT_APPROVAL}`,
		details(question, options, null, false, "unavailable"),
	);
}

function invalidResult(question: string, options: string[], reason: string): AskUserResult {
	return result(`Unable to ask the user: ${reason}. ${NOT_APPROVAL}`, details(question, options, null, false, "invalid"));
}

async function askForCustomAnswer(
	question: string,
	options: string[],
	ui: AskUserUI,
	prefilled?: string,
): Promise<AskUserResult> {
	let raw: string | undefined = prefilled;
	if (raw === undefined) {
		raw = await ui.input(question, "Type your answer…");
	}
	if (raw === undefined) {
		return cancelledResult(question, options);
	}
	const answer = raw.trim();
	if (!answer) {
		return emptyResult(question, options);
	}
	return customResult(question, options, answer);
}

/**
 * Ask the human a question.
 *
 * @param params The question and selectable options.
 * @param ui Interactive UI adapter, or undefined when no UI is available.
 */
export async function askUser(params: AskUserParams, ui: AskUserUI | undefined): Promise<AskUserResult> {
	const question = typeof params?.question === "string" ? params.question.trim() : "";
	const rawOptions = Array.isArray(params?.options) ? params.options : [];
	const options = rawOptions.filter(
		(option): option is AskUserOption =>
			!!option && typeof option.label === "string" && option.label.trim().length > 0,
	);
	const labels = options.map((option) => option.label);
	const allowCustom = params?.allowCustom !== false;

	if (!question) {
		return invalidResult(question, labels, "the question text is empty");
	}
	if (!ui) {
		return unavailableResult(question, labels);
	}
	if (labels.length === 0 && !allowCustom) {
		return invalidResult(question, labels, "no options were provided and custom answers are disabled");
	}
	if (labels.length === 0) {
		return askForCustomAnswer(question, labels, ui);
	}

	const choices = allowCustom ? [...labels, CUSTOM_ANSWER_LABEL] : labels;
	const selected = await ui.select(question, choices);

	if (selected === undefined) {
		return cancelledResult(question, labels);
	}
	if (allowCustom && selected === CUSTOM_ANSWER_LABEL) {
		return askForCustomAnswer(question, labels, ui);
	}

	const match = options.find((option) => option.label === selected);
	if (!match) {
		// Defensive: if a UI returns an unexpected value, only treat it as a custom
		// answer when custom answers are allowed. Otherwise refuse rather than
		// silently accepting a value the caller explicitly did not permit.
		if (!allowCustom) {
			return invalidResult(question, labels, "the UI returned a selection that does not match any option");
		}
		return askForCustomAnswer(question, labels, ui, selected);
	}
	return selectedResult(question, labels, match.value ?? match.label);
}
