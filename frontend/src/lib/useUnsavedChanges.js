import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { registerDirtyGuard } from "./dirtyGuard";

/**
 * Tracks whether an editable document has drifted from its last-saved state,
 * and guards the ways a user can lose that work.
 *
 * Dirtiness is a comparison against a baseline snapshot rather than a flag set
 * by every edit handler: a flag has to be reset in a dozen places and silently
 * rots, while a snapshot cannot disagree with what is actually on screen. Undoing
 * an edit by hand correctly reports "clean" again.
 *
 * Each instance registers its dirty state with the shared app shell, which owns
 * the single router blocker and beforeunload listener. Keeping those global is
 * what allows a dialog to sit over another editor without competing blockers.
 * `confirmDiscard` remains local for closing the form or dialog itself.
 */
export function useUnsavedChanges(current, { enabled = true } = {}) {
	const [baseline, setBaseline] = useState(() => serialize(current));
	const [prompt, setPrompt] = useState(null);

	const serialized = useMemo(() => serialize(current), [current]);
	const dirty = enabled && serialized !== baseline;

	// Keep the latest value readable from the event handler without
	// re-registering the listener on every keystroke.
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;

	// Re-registering when the value changes also notifies the shell's external
	// store subscription. The source reads the ref so it cannot go stale between
	// render and effect cleanup.
	useEffect(() => registerDirtyGuard({ isDirty: () => dirtyRef.current }), [dirty]);

	/**
	 * Call after a successful save or a clean server/bootstrap load so the current
	 * state becomes the new clean point. Intentional prefills that represent new
	 * work should not call this; they must continue to trigger the guard.
	 */
	const markSaved = useCallback(
		(next) => {
			setBaseline(serialize(next === undefined ? current : next));
			// `current` is intentionally read at call time.
		},
		[current]
	);

	/**
	 * Run `action`, but if there are unsaved changes ask first. Returns a promise
	 * so callers can await the user's decision.
	 */
	const confirmDiscard = useCallback(
		(action, opts = {}) =>
			new Promise((resolve) => {
				if (!dirtyRef.current) {
					resolve(true);
					action?.();
					return;
				}

				setPrompt({
					...opts,
					onConfirm: () => {
						setPrompt(null);
						resolve(true);
						action?.();
					},
					onCancel: () => {
						setPrompt(null);
						resolve(false);
					},
				});
			}),
		[]
	);

	return { dirty, prompt, confirmDiscard, markSaved };
}

/**
 * Stable stringify: key order must not affect equality, or a state update that
 * rebuilds an object would look like an edit.
 */
function serialize(value) {
	return JSON.stringify(value, (_key, val) => {
		if (val && typeof val === "object" && !Array.isArray(val)) {
			return Object.keys(val)
				.sort()
				.reduce((acc, k) => {
					// Drop empty-ish values so "" and undefined compare equal - they
					// mean the same thing in these forms and would cause false dirt.
					if (val[k] !== undefined && val[k] !== null && val[k] !== "") {
						acc[k] = val[k];
					}
					return acc;
				}, {});
		}
		if (typeof val === "string" && val.trim() !== "" && /^-?\d+(\.\d+)?$/.test(val.trim())) {
			return Number(val);
		}
		return val;
	});
}
