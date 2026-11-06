# Collapsible cards

Use the shared `Card` with `collapsible` for optional supporting workflows. Cards remain expanded and noncollapsible by default; `defaultCollapsed` opts into an initially compact panel.

- The heading contains a native button with `aria-expanded` and `aria-controls`, a directional chevron, visible keyboard focus, and a minimum 44 by 44 pixel target.
- Keep header actions outside the heading button. Do not place interactive controls inside its title.
- Keep collapsed content mounted but hidden so field values, previews, and pending work survive reopening. Hidden controls must leave the tab order.
- Use a short translated description or status to make the closed panel understandable. Keep essential errors and work outcomes discoverable when the panel is reopened.
- Compact expanded spacing may reduce visual padding, never control touch targets or available functionality. Verify keyboard toggling, state retention, English/Arabic, and mobile/desktop layouts.
