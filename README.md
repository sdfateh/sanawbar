# Sanawbar

Shared platform services, Arabic-first React components, and the Sanawbar theme
for Frappe v16 apps.

The app is the common foundation for the Sanawbar product family. It owns shared
presentation and Frappe-shell infrastructure today, and may grow shared actions
and integrations that apply across products. Domain-specific workflows and data
models remain in their consuming apps.


## English and Arabic localization

English source strings are the keys in each app's `translations/ar.json`.
Use the shared `__()` helper in React and the app's `i18n._()` on the server.
Keep stored status codes, document names, and item identifiers unchanged;
translate their display labels. For ambiguous words, use explicit labels or
`__(text, args, context)` so a financial action cannot change a shared control.

JSON is the editable source. The matching CSV is generated for native Frappe
Desk labels, reports, and print templates. After reviewing Arabic wording,
regenerate and validate it from the Sanawbar repository:

```bash
python3 -m sanawbar.translation_catalog --write sanawbar/translations/ar.json ../mfg_suite/mfg_suite/translations/ar.json ../cheque_management/cheque_management/translations/ar.json
python3 -m sanawbar.translation_catalog --check sanawbar/translations/ar.json ../mfg_suite/mfg_suite/translations/ar.json ../cheque_management/cheque_management/translations/ar.json
```

The check rejects duplicate keys, blank translations, changed placeholders, and
stale CSV files. The read-only source scanner checks literal keys and reports
dynamic expressions and unwrapped JSX for human review; run it with Python 3.14:

```bash
python3 tools/check_translation_coverage.py --app ../mfg_suite --shared . --node-modules ../mfg_suite/mfg/node_modules
```

Repeat for each consumer. Review Arabic in its screen or report context:
`Work Order` is **أمر تصنيع**, `Rework` is **إعادة المعالجة**, cheque settlement
is **تسوية الشيك**, and clearing an input is **مسح**. Codes, standard material
abbreviations, and customer-supplied names retain their original spelling.
