"""Read-only live verification: bench --site SITE execute sanawbar.tests.verify_business_export.verify_current_site.

Uses the production snapshot reader and SQL writer, then independently compares
source rows, imported SQLite values and exact financial totals. Temporary SQL,
ZIP and SQLite files are private and deleted before returning the count report.
Does not create tracking records, queue jobs, consume quota or publish a file.
"""

import collections
import datetime
import json
import sqlite3
import tempfile
import zipfile
from decimal import Decimal, localcontext
from pathlib import Path

import frappe

from sanawbar.business_export.engine import (
	COLLECTION_NAMES,
	DYNAMIC_LINKS,
	SCHEMA,
	references,
	write_package,
)
from sanawbar.business_export.snapshot import snapshot_reader


def scalar(v):
	if v is None:
		return None
	if isinstance(v, bool):
		return "1" if v else "0"
	if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
		return v.isoformat()
	return str(v)


def verify_current_site():
	scope = frappe.get_all("Company", pluck="name")
	with snapshot_reader() as (reader, stamp):
		data = reader.collect(scope)
		source_counts = {}
		absent = {}
		source_checked = 0
		for dt, spec in SCHEMA.items():
			fields = reader.fields(dt)
			if not fields:
				continue
			projection = ", ".join("`" + f + "`" if f in fields else "NULL" for f in spec["fields"])
			reader.cursor.execute("SELECT " + projection + " FROM `tab" + dt + "`")
			raw = reader.cursor.fetchall()
			source_counts[dt] = len(raw)
			absent[dt] = [f for f in spec["fields"] if f not in fields]
			found = set()
			for values in raw:
				name = values[spec["fields"].index("name")]
				if name not in data[dt]:
					continue
				row = data[dt][name]
				originals = row.get("_original_refs", {})
				assert tuple(originals.get(f, row.get(f)) for f in spec["fields"]) == values, (
					"source_value_mismatch",
					dt,
				)
				found.add(name)
				source_checked += 1
			assert found == set(data[dt]), ("fabricated_source_ids", dt)
		with tempfile.TemporaryDirectory(prefix="business-export-review-") as directory:
			path, manifest = write_package(directory, data, stamp, scope, reader.missing)
			with zipfile.ZipFile(path) as archive:
				assert archive.namelist() == ["business-data.sql"]
				sql = archive.read("business-data.sql").decode()
			con = sqlite3.connect(str(Path(directory) / "verification.sqlite"))
			con.executescript(sql)
			del sql
			assert con.execute("PRAGMA integrity_check").fetchone() == ("ok",)
			count = 0
			cells = 0
			relations = 0
			links_checked = 0
			for dt, spec in SCHEMA.items():
				colsql = ", ".join(
					'"' + c + '"' for c in [*spec["columns"], spec["reference_originals_column"]]
				)
				actual = con.execute("SELECT " + colsql + ' FROM "' + spec["table"] + '" ORDER BY "id"')
				expected_rows = sorted(data[dt].values(), key=lambda r: r["name"])
				assert manifest["counts"][spec["table"]] == len(expected_rows)
				for expected, exported in zip(expected_rows, actual, strict=True):
					if spec["child"]:
						assert expected["parent"] in data[expected["parenttype"]], ("missing_parent", dt)
					for field, target, name in references(dt, expected):
						if name not in data[target]:
							assert not reader.read(target, "name", [name]), ("omitted_reference", dt, field)
						else:
							links_checked += 1
					expected_values = []
					for f in spec["fields"]:
						v = expected.get(f)
						if f == "parenttype" and v:
							v = SCHEMA[v]["table"]
							relations += 1
						elif f == "parentfield" and v:
							v = COLLECTION_NAMES.get((expected["parenttype"], v), spec["table"])
						elif f in [pair[0] for pair in DYNAMIC_LINKS.get(dt, [])] and v:
							v = SCHEMA[v]["table"]
							relations += 1
						expected_values.append(scalar(v))
					originals = expected.get("_original_refs", {})
					expected_values.append(
						json.dumps(
							{spec["columns"][spec["fields"].index(f)]: v for f, v in originals.items()},
							ensure_ascii=False,
							sort_keys=True,
						)
						if originals
						else None
					)
					assert tuple(expected_values) == exported, ("export_value_mismatch", dt)
					count += 1
					cells += len(exported)
			# Compare exact financial/quantity totals with the MariaDB snapshot, not SQLite REAL SUM.
			aggregate_checks = 0
			with localcontext() as ctx:
				ctx.prec = 128
				for dt, fields in {
					"GL Entry": ["debit", "credit"],
					"Payment Ledger Entry": ["amount"],
					"Stock Ledger Entry": ["actual_qty", "stock_value_difference"],
					"Sales Invoice": ["grand_total", "outstanding_amount"],
					"POS Invoice": ["grand_total", "paid_amount"],
					"EV Charging Session": ["actual_energy_kwh", "actual_cost_jod"],
				}.items():
					spec = SCHEMA[dt]
					for f in fields:
						if f not in reader.fields(dt):
							continue
						reader.cursor.execute("SELECT SUM(`" + f + "`) FROM `tab" + dt + "`")
						original = reader.cursor.fetchone()[0] or Decimal(0)
						alias = spec["columns"][spec["fields"].index(f)]
						total = sum(
							(
								Decimal(v[0])
								for v in con.execute('SELECT "' + alias + '" FROM "' + spec["table"] + '"')
								if v[0] is not None
							),
							Decimal(0),
						)
						assert total == original, ("aggregate_mismatch", dt, f)
						aggregate_checks += 1
			con.close()
			result = {
				"snapshot_utc": stamp,
				"tables": len(SCHEMA),
				"source_rows_verified": source_checked,
				"sql_rows_verified": count,
				"cells_verified": cells,
				"mapped_references_verified": relations,
				"existing_reference_targets_verified": links_checked,
				"normalized_reference_values": sum(
					len(row.get("_original_refs", {})) for rows in data.values() for row in rows.values()
				),
				"exact_aggregate_checks": aggregate_checks,
				"zip_bytes": path.stat().st_size,
				"missing_references": dict(
					collections.Counter(
						(x["table"] + " -> " + x["target_table"] + " (" + x["field"] + ")")
						for x in reader.missing
					)
				),
				"counts": {
					dt: {"source": source_counts.get(dt, 0), "exported": len(data[dt])} for dt in SCHEMA
				},
				"absent_allowed_fields": {dt: fs for dt, fs in absent.items() if fs},
			}
			return result
