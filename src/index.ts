/**
 * Pi extension entry point.
 *
 * Registers the ask_user tool. The Pi API is described structurally so the
 * extension has no import that must be resolved at load time; Pi (via jiti)
 * calls the default export with the real ExtensionAPI.
 */

import { buildAskUserTool, type AskUserToolDefinition } from "./tool.ts";

/** Minimal structural view of the Pi ExtensionAPI used by this extension. */
export interface ExtensionAPI {
	registerTool(tool: AskUserToolDefinition): void;
}

export default function askUserExtension(pi: ExtensionAPI): void {
	pi.registerTool(buildAskUserTool());
}
