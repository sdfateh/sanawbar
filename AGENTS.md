# Sanawbar Family Agent Rules

These are the canonical cross-application rules for Sanawbar and every app that
depends on it. Consumer repositories must read this file before applying their
own local rules.

## Product and dependency boundaries

- `sanawbar` is the shared platform foundation, not a UI-only package. It may
  own shared actions, services, integrations, shell infrastructure, design
  system code, and theme behavior that genuinely apply across products.
- Domain-specific workflows, APIs, permissions, DocTypes, and data models stay
  in the consuming application.
- Dependency direction is one-way: consumer apps may depend on `sanawbar`, but
  `sanawbar` must never import a consumer app or assume that one is installed.
- Put behavior in `sanawbar` only when it has a domain-neutral contract and at
  least one credible cross-app use. Do not turn it into a miscellaneous utility
  collection.
- Keep `required_apps` in `hooks.py` consistent with
  `[tool.bench.frappe-dependencies]` in `pyproject.toml`.

## Design rules first

- Before planning or implementing a user-interface change, read
  `design-rules/README.md` and every linked rule relevant to the interface.
- Treat those rules as the visual and interaction source of truth. Reuse the
  named components and update the relevant rule when an approved pattern
  evolves.

## Arabic-first product

- Arabic and RTL behavior are primary requirements for every user interface.
- Every user-facing string must use the applicable translation helper and
  receive an Arabic translation in the same change.
- Use logical layout properties, preserve bidirectional rendering for codes and
  Arabic names, and verify both RTL and LTR layouts.

## Shared-component ownership

- Inspect `@sanawbar/core` before creating a generic component or utility in a
  consumer app. App-specific adapters may inject domain APIs into shared
  components, but must not duplicate their generic behavior.
- Before changing a shared component, shared API, token, or theme contract,
  find and review all consumers. Prefer backward-compatible extension.
- If a requested shared change conflicts with another consumer, stop and ask
  the user how to resolve the contract. Do not silently regress a consumer,
  fork the shared component, or hide a page-specific workaround in Sanawbar.
- Before adding a component, search all consumer repositories for an existing
  component with substantially the same responsibility. If duplication still
  appears necessary, explain the reuse option and request approval.

## Frappe and ERPNext first

- Reuse installed Frappe or ERPNext DocTypes, workflows, services, and APIs
  before introducing custom equivalents.
- If the framework provides substantially similar functionality but a custom
  implementation still appears necessary, explain the existing option and ask
  the user for approval.

## Server-side security and data integrity

- Client visibility, navigation guards, and disabled controls are never
  permission boundaries. Every write endpoint must enforce roles, DocType
  permissions, and document-level permissions on the server.
- Do not use `frappe.db.set_value`; it bypasses normal permission checks,
  controller lifecycle behavior, and document history. Load the document and
  save it through its controller instead.
- If direct database mutation appears critically necessary, stop and ask the
  user explicitly. State which permission, validation, lifecycle, and history
  behavior would be bypassed.

## Accessibility and verification

- Interactive touch targets must be at least 44 by 44 CSS pixels on tablet and
  touch layouts.
- All actions must work by keyboard, show visible focus, and use appropriate
  semantic controls. Essential actions or information must never be hover-only.
- Validate changes in proportion to risk. Shared changes must be checked in
  every affected consumer, including production builds when build wiring or
  shared frontend code changes.

## Sanawbar-specific rules

- Public frontend exports belong to `@sanawbar/core`; keep peer dependencies
  explicit and avoid bundling a second React or router runtime into consumers.
- Shared backend services must accept consumer configuration or adapters rather
  than importing domain modules.
- Theme tokens and asset namespaces use `sanawbar`, never a consumer name.
- A breaking shared contract change must update every in-workspace consumer and
  its migration notes in the same change.
