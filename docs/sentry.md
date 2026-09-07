# Sentry configuration

Sanawbar provides the browser initializer used by the three product frontends.
Frappe's existing backend integration remains responsible for Python requests
and workers.

## Environment variables

```text
FRAPPE_SENTRY_DSN       shared Python backend project
MFG_SENTRY_DSN          MFG browser project
CATALOG_SENTRY_DSN      Catalog browser project
CHEQUES_SENTRY_DSN      Cheques browser project
SENTRY_ENVIRONMENT      production, staging, or development
MFG_SENTRY_RELEASE      optional MFG release override
CATALOG_SENTRY_RELEASE  optional Catalog release override
CHEQUES_SENTRY_RELEASE  optional Cheques release override
```

When a release override is absent, the current Frappe asset build version is
used. Restart web processes after changing environment variables.

Each site must opt in through System Settings > Enable Telemetry. Sites without
that setting, or without the product DSN, receive no browser Sentry config.

Browser events are tagged with `product` and `tenant`. Query strings and URL
fragments are removed from event request URLs and breadcrumbs, and default PII
collection is disabled. DSNs are public routing keys and may be embedded in the
page; Sentry auth tokens and source-map upload tokens must never be included.

## Frappe Cloud

Add the variables to the private bench's Environment Variables table. They are
bench-wide, so every site on that bench uses the same product DSNs and is
separated by the `tenant` tag. Do not put these custom keys in Site Config: the
integration reads process environment variables.

## Temporary verification pages

After deployment, sign in as a System Manager and open each installed product:

```text
/mfg/sentry-test
/catalog/sentry-test
/cheques/sentry-test
```

Each page sends one intentional browser exception only when **Send test error**
is pressed. A successful flush displays the Sentry event ID. These routes are
server-gated to System Manager and should be removed after deployment is
verified.
