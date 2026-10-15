# Sanawbar

Shared platform services, Arabic-first React components, and the Sanawbar theme
for Frappe v15 apps.

The app is the common foundation for the Sanawbar product family. It owns shared
presentation and Frappe-shell infrastructure today, and may grow shared actions
and integrations that apply across products. Domain-specific workflows and data
models remain in their consuming apps.

## Business data exports

The **Backup export** page (`/app/backup-export`) provides one-click, site-local business data exports for the Business Data Exporter role. See [setup, security, schema and limitations](docs/business-export.md) and the [exact field allowlist](docs/business-export-schema.md).
