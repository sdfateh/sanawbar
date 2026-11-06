# Full record titles

Use the shared `LinkField` with `wrapLabels` when users must read complete item or record names during selection. Other consumers keep the default compact, single-line options.

- Wrap the complete option title and its secondary code/context; do not rely on hover tooltips. Keep record codes distinct from readable names, and keep the stored `value` as the code.
- The opt-in dropdown has a 360px minimum width, clamped to the viewport. Keep its portal outside table overflow containers so horizontal table scrolling cannot clip it.
- Preserve keyboard search, arrow selection, Enter, Escape and clear. Options and clear controls retain at least 44px touch targets. Supply an accessible field name, using `aria-label` when no visible label exists.
- For selected editable item names, allow visual wrapping and natural height while retaining single-line data semantics, disabled/read-only behavior and any maximum length. Recalculate height after value changes, container resizing and font loading; clearing a name restores compact height.
- Give table name columns a practical minimum width. Contain necessary horizontal scrolling within the table, never the page. Check long Arabic, English and unbroken names on phone and desktop, including read-only records.
