/**
 * Minimal ambient declarations for the Node.js built-ins used by the tests.
 *
 * They keep the project dependency-free: `npm test` runs with no install and an
 * editor (or `tsc --noEmit`) can type-check the sources without `@types/node`.
 * (`AbortSignal` comes from the TypeScript DOM library configured in tsconfig.json.)
 */

declare module "node:test" {
	export function test(name: string, fn: () => void | Promise<void>): void;
	export function test(name: string, fn: (t: unknown) => void | Promise<void>): void;
}

declare module "node:assert/strict" {
	interface Assert {
		equal(actual: unknown, expected: unknown, message?: string): void;
		deepEqual(actual: unknown, expected: unknown, message?: string): void;
		match(value: string, regexp: RegExp, message?: string): void;
		ok(value: unknown, message?: string): void;
	}
	const assert: Assert;
	export default assert;
}
