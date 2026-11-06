# Application page navigation

Use `@sanawbar/core/components/AppShell` and its shared `PageNavigation` for product page navigation. Consumer apps own their routes, permissions, link labels, and optional `group` labels. Hidden links (`show: false`) are excluded before rendering; navigation never grants access.

- Show full page names. Icons support the label; they must not replace it.
- Keep the current page visible in the closed navigation. Nested routes belong to their nearest matching page; exact-only links use `end: true`.
- Never use a horizontally scrolling header navigation strip. Large products organize their links into a few recognizable task groups. Keep every allowed page available through these groups.
- Below the large desktop breakpoint, large products use a labelled **Pages** disclosure that displays the current page and all groups. Short navigation lists retain direct labelled links from the tablet breakpoint upward.
- Open menus may scroll vertically within the viewport. Labels wrap instead of being truncated, and all controls and route links provide at least 44 by 44 CSS pixel targets.
- Menus are nonmodal navigation disclosures, not modal dialogs. Opening focuses the current route (or the first route). Tab moves naturally between controls and continues to the next header control when leaving the portalled panel. Shift+Tab from its first control returns to the trigger. Escape and the close button restore trigger focus. Pointer or focus outside dismisses the panel without stealing focus.
- A route selection closes the disclosure. Resizing also closes it so a panel cannot remain attached to a hidden responsive trigger.
- Use logical spacing and alignment. Translate group and page labels through the shared helper, preserving document IDs and user content as data. Verify English and Arabic at phone, tablet, and desktop widths.

Run `frontend/tests/navigation.cjs` with isolated production builds of each consumer to check discovery, keyboard behavior, target sizes, header overflow, and accessibility. The runner accepts only `/tmp/` build directories and synthetic API responses.
