# Empty States

Use `EmptyState` from `@sanawbar/core` for an empty collection, an empty filtered result, unavailable content, or a recoverable loading error. Do not recreate empty-state layout in a route or feature component.

## Canonical presentation

- Keep the state compact: a dashed boundary, centered sentence-case message, optional short description, and one action when the user can resolve the state.
- Use a semantic icon only when it clarifies a distinct state such as search, permissions, errors, or unavailable content. Do not add decorative icons to ordinary empty collections.
- Use the shared `Button` for actions. `EmptyState` normalizes its action to the compact `sm` size; empty-collection creation actions use the soft treatment, while recovery actions may use the treatment appropriate to their meaning.
- Keep actions compact on desktop and at least 44 by 44 CSS pixels on tablet and touch layouts. Every action must remain keyboard operable, visibly focusable, and available without hover.
- Put the empty state where the missing content would normally appear. A containing `Card` may provide the section surface; do not add large fixed or minimum heights.

## Copy

- State what is absent in one short sentence, for example “No production plans yet.”
- Use a direct action label, for example “Create the first plan”.
- Pass every user-facing string through `__()` and add its Arabic translation in the same change.
