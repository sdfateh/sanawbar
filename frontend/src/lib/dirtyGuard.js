/**
 * Cross-route registry for "is there unsaved work right now?".
 *
 * The Clear Cache button lives in the app header while the unsaved state lives
 * inside editor routes and dialogs, so the shell needs a way to ask without
 * threading props through the router. More than one editor can be active (for
 * example Customer Quick Entry over an estimate), hence a set rather than one
 * replaceable slot.
 */
const guards = new Set();
const listeners = new Set();

function emit() {
	for (const listener of listeners) listener();
}

export function registerDirtyGuard(guard) {
	guards.add(guard);
	emit();
	return () => {
		guards.delete(guard);
		emit();
	};
}

/** True when any active screen or dialog has unsaved changes. */
export function hasUnsavedChanges() {
	return [...guards].some((guard) => Boolean(guard?.isDirty?.()));
}

/** Subscribe the app shell to dirty-source changes. */
export function subscribeDirtyGuards(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
