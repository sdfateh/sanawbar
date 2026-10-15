"""Closed business schema and lossless SQLite SQL writer; no Frappe dependency."""

import datetime
import hashlib
import json
import math
import zipfile
from decimal import Decimal, localcontext
from pathlib import Path

VERSION = 6
SCHEMA = json.loads(Path(__file__).with_name("schema.json").read_text())


def column_name(doctype, field):
	spec = SCHEMA[doctype]
	return spec["columns"][spec["fields"].index(field)]


for _spec in SCHEMA.values():
	if len(_spec["fields"]) != len(_spec["columns"]) or len(set(_spec["columns"])) != len(_spec["columns"]):
		raise ValueError("Invalid fixed export column mapping")
# Dynamic references are deliberately enumerated, never discovered from metadata.
DYNAMIC_LINKS = {
	"Payment Entry": [("party_type", "party")],
	"GL Entry": [
		("party_type", "party"),
		("voucher_type", "voucher_no"),
		("against_voucher_type", "against_voucher"),
	],
	"Payment Ledger Entry": [
		("party_type", "party"),
		("voucher_type", "voucher_no"),
		("against_voucher_type", "against_voucher_no"),
	],
	"Journal Entry Account": [
		("party_type", "party"),
		("reference_type", "reference_name"),
		("advance_voucher_type", "advance_voucher_no"),
	],
	"Payment Entry Reference": [
		("reference_doctype", "reference_name"),
		("advance_voucher_type", "advance_voucher_no"),
	],
	"Sales Invoice Advance": [("reference_type", "reference_name")],
	"Purchase Invoice Advance": [("reference_type", "reference_name")],
	"Stock Ledger Entry": [("voucher_type", "voucher_no")],
	"Serial and Batch Bundle": [("voucher_type", "voucher_no")],
	"Quotation": [("quotation_to", "party_name")],
	"Dynamic Link": [("link_doctype", "link_name")],
	"Landed Cost Purchase Receipt": [("receipt_document_type", "receipt_document")],
	"Landed Cost Item": [("receipt_document_type", "receipt_document")],
	"Bank Account": [("party_type", "party")],
	"Bank Transaction": [("party_type", "party")],
	"Bank Transaction Payments": [("payment_document", "payment_entry")],
}
COLLECTION_NAMES = {
	("URY Daily P and L", "other_expenses"): "other_expenses",
	("URY Daily P and L", "direct_expenses_breakup"): "direct_expenses",
	("URY Daily P and L", "employee_costs_breakup"): "employee_costs",
	("URY Daily P and L", "indirect_expenses_breakup"): "indirect_expenses",
}
# The source field name is misleading: it can point to either kind of purchase line.
CONDITIONAL_LINKS = {
	"Landed Cost Item": [
		(
			"receipt_document_type",
			"purchase_receipt_item",
			{"Purchase Receipt": "Purchase Receipt Item", "Purchase Invoice": "Purchase Invoice Item"},
		)
	]
}


class ExportError(Exception):
	"""The closed schema cannot safely represent this dataset."""


def references(doctype, row):
	for field, target in SCHEMA[doctype]["links"].items():
		if row.get(field) not in (None, ""):
			yield field, target, row[field]
	for type_field, name_field in DYNAMIC_LINKS.get(doctype, []):
		if row.get(name_field) not in (None, ""):
			target = row.get(type_field)
			if target not in SCHEMA:
				raise ExportError("Unsupported business reference type")
			yield name_field, target, row[name_field]
	for type_field, name_field, targets in CONDITIONAL_LINKS.get(doctype, []):
		if row.get(name_field) not in (None, ""):
			target = targets.get(row.get(type_field))
			if target is None:
				raise ExportError("Unsupported business detail reference type")
			yield name_field, target, row[name_field]


def original_reference_values(doctype, row):
	originals = row.get("_original_refs", {})
	if not originals:
		return None
	allowed = set(SCHEMA[doctype]["links"])
	allowed.update(name for _, name in DYNAMIC_LINKS.get(doctype, []))
	allowed.update(name for _, name, _ in CONDITIONAL_LINKS.get(doctype, []))
	if SCHEMA[doctype]["child"]:
		allowed.add("parent")
	if not set(originals) <= allowed:
		raise ExportError("Unexpected original reference field")
	return json.dumps(
		{column_name(doctype, field): value for field, value in originals.items()},
		ensure_ascii=False,
		sort_keys=True,
	)


def literal(value):
	"""SQLite hex text literals handle quotes, backslashes, NUL and Unicode exactly."""
	if value is None:
		return "NULL"
	if isinstance(value, bool):
		value = "1" if value else "0"
	elif isinstance(value, Decimal):
		if not value.is_finite():
			raise ExportError("Non-finite decimal")
		value = str(value)
	elif isinstance(value, float):
		if not math.isfinite(value):
			raise ExportError("Non-finite number")
		# Financial DECIMAL columns must arrive as Decimal from the source driver.
		value = repr(value)
	elif isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
		value = value.isoformat()
	elif isinstance(value, datetime.timedelta):
		value = str(value)
	elif not isinstance(value, (str, int)):
		raise ExportError("Unsupported scalar type")
	return "CAST(X'" + str(value).encode("utf-8").hex() + "' AS TEXT)"


def dictionary():
	return {
		"version": VERSION,
		"dialect": "SQLite 3",
		"encoding": "UTF-8",
		"values": "All columns are TEXT. Decimal strings are exact; use decimal arithmetic, not REAL. "
		"NULL means absent; zero and false are retained. The column mapped from docstatus uses "
		"0 draft, 1 submitted, 2 cancelled. "
		"Source date/time values use the site's local timezone unless explicitly identified as UTC.",
		"tables": {
			s["table"]: {
				"source": dt,
				"columns": {
					code: {"source_field": field, "type": "TEXT"}
					for field, code in zip(s["fields"], s["columns"], strict=True)
				}
				| {
					s["reference_originals_column"]: {
						"type": "TEXT",
						"meaning": "Original reference spellings as JSON",
					}
				},
				"links": {column_name(dt, f): SCHEMA[t]["table"] for f, t in s["links"].items()},
				"dynamic_links": [
					[column_name(dt, kind), column_name(dt, name)] for kind, name in DYNAMIC_LINKS.get(dt, [])
				],
				"conditional_links": [
					{
						"type_column": column_name(dt, kind),
						"id_column": column_name(dt, name),
						"targets": {SCHEMA[k]["table"]: SCHEMA[v]["table"] for k, v in targets.items()},
					}
					for kind, name, targets in CONDITIONAL_LINKS.get(dt, [])
				],
				"parents": [
					[SCHEMA[p]["table"], COLLECTION_NAMES.get((p, f), s["table"])] for p, f in s["parents"]
				],
			}
			for dt, s in SCHEMA.items()
		},
	}


def write_package(directory, rows, snapshot, scope, missing_references=(), source_timezone="unspecified"):
	"""Write only to a caller-owned staging directory; publication is a separate step."""
	directory = Path(directory)
	sql_path = directory / "business-data.sql"
	with sql_path.open("w", encoding="utf-8", newline="\n") as out:
		out.write(
			f"-- Business data export v{VERSION}; SQLite 3; exact decimals stored as TEXT.\nBEGIN TRANSACTION;\n"
		)
		for dt, spec in SCHEMA.items():
			columns = [*spec["columns"], spec["reference_originals_column"]]
			out.write(
				f'CREATE TABLE "{spec["table"]}" ('
				+ ", ".join(
					f'"{c}" TEXT' + (" PRIMARY KEY" if f == "name" else "")
					for f, c in zip([*spec["fields"], None], columns, strict=True)
				)
				+ ");\n"
			)
			for row in sorted(rows.get(dt, {}).values(), key=lambda r: r["name"]):
				values = []
				for field in spec["fields"]:
					value = row.get(field)
					if field == "parenttype" and value:
						value = SCHEMA[value]["table"]
					if field == "parentfield" and value:
						if [row.get("parenttype"), value] not in spec["parents"]:
							raise ExportError("Unsupported child relationship")
						value = COLLECTION_NAMES.get((row["parenttype"], value), spec["table"])
					if field in {type_field for type_field, _ in DYNAMIC_LINKS.get(dt, [])} and value:
						if value not in SCHEMA:
							raise ExportError("Unsupported business reference type")
						value = SCHEMA[value]["table"]
					values.append(literal(value))
				values.append(literal(original_reference_values(dt, row)))
				out.write(
					f'INSERT INTO "{spec["table"]}" ('
					+ ", ".join(f'"{c}"' for c in columns)
					+ ") VALUES ("
					+ ", ".join(values)
					+ ");\n"
				)
		out.write("COMMIT;\n")
	manifest = {
		"export_version": VERSION,
		"dialect": "SQLite 3",
		"snapshot_time_utc": snapshot,
		"source_timezone": source_timezone,
		"accounting_totals": accounting_totals(rows),
		"scope": {"companies": sorted(scope), "tenant": "current authenticated site database"},
		"counts": {s["table"]: len(rows.get(dt, {})) for dt, s in SCHEMA.items()},
		"missing_existing_references": list(missing_references),
		"attachments_included": False,
		"checksums": {sql_path.name: sha256_file(sql_path)},
		"limitations": "Independent business schema; not a Frappe restore. No application configuration, "
		"users or custom fields beyond the explicit allowlist. Missing/deleted reference targets are not synthesized.",
	}
	package = directory / "export.zip"
	with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
		archive.write(sql_path, sql_path.name)
	return package, manifest


def sha256_file(path):
	h = hashlib.sha256()
	with open(path, "rb") as stream:
		for chunk in iter(lambda: stream.read(1024 * 1024), b""):
			h.update(chunk)
	return h.hexdigest()


def accounting_totals(rows):
	"""Exact base-currency debit/credit totals; retain cancelled records separately."""
	totals = {}
	with localcontext() as context:
		# MariaDB DECIMAL has at most 65 digits; ample room for aggregation.
		context.prec = 128
		for row in rows.get("GL Entry", {}).values():
			key = (row.get("company"), str(row.get("is_cancelled") or 0))
			group = totals.setdefault(key, {"debit": Decimal(0), "credit": Decimal(0)})
			for field in ("debit", "credit"):
				value = row.get(field)
				group[field] += Decimal(0) if value is None else Decimal(str(value))
		return [
			{
				"company": company,
				"is_cancelled": cancelled,
				"debit": str(values["debit"]),
				"credit": str(values["credit"]),
				"difference": str(values["debit"] - values["credit"]),
			}
			for (company, cancelled), values in sorted(totals.items())
		]
