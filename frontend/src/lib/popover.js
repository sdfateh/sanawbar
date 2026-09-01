import { useCallback, useLayoutEffect, useState } from "react";

import { isRTL } from "./i18n";

/**
 * Position a portal popover under (or over) an anchor element.
 *
 * Every dropdown in the app renders in a portal on document.body, so it cannot
 * be clipped by an ancestor's overflow (a table's overflow-x-auto) or painted
 * over by a later sibling card. The cost of that is that its position has to be
 * measured explicitly - which is this hook, shared so LinkField, Select and
 * anything after them flip, clamp and follow the page identically.
 *
 * Returns the measured position, or null while closed.
 */
export function usePopoverPosition(anchorRef, open, { maxHeight = 240, minWidth = 220 } = {}) {
	const [pos, setPos] = useState(null);

	const place = useCallback(() => {
		const el = anchorRef.current;
		if (!el) return;

		const r = el.getBoundingClientRect();
		const gap = 4;
		const below = window.innerHeight - r.bottom;
		// Flip above the field when there is not enough room below it.
		const dropUp = below < maxHeight + gap && r.top > below;

		const width = Math.min(Math.max(r.width, minWidth), window.innerWidth - gap * 2);
		const logicalLeft = isRTL ? r.right - width : r.left;

		setPos({
			top: dropUp ? r.top - gap : r.bottom + gap,
			left: Math.max(gap, Math.min(logicalLeft, window.innerWidth - width - gap)),
			width,
			dropUp,
			maxHeight: Math.min(maxHeight, (dropUp ? r.top : below) - gap * 2),
		});
	}, [anchorRef, maxHeight, minWidth]);

	useLayoutEffect(() => {
		if (!open) return;

		place();
		// Keep it pinned to the anchor while the page moves under it.
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [open, place]);

	return pos;
}

// Above the dialogs, which all sit at z-10000. A popover is always opened *from*
// something, so it has to paint over whatever that thing is - at 9999 a LinkField
// or Select inside a dialog silently dropped its list behind the dialog and read
// as "the field returns no data". DateTimePicker had already picked 10050 for its
// own panel for this reason; this is the same number, now shared by every popover.
const POPOVER_Z = 10050;

/** Inline styles for a popover placed by `usePopoverPosition`. */
export function popoverStyle(pos) {
	return {
		position: "fixed",
		top: pos.dropUp ? undefined : pos.top,
		bottom: pos.dropUp ? window.innerHeight - pos.top : undefined,
		left: pos.left,
		width: pos.width,
		maxHeight: pos.maxHeight,
		zIndex: POPOVER_Z,
	};
}
