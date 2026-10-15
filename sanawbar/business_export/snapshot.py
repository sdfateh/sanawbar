"""MariaDB consistent-snapshot reader using a separate, read-only connection."""

from contextlib import contextmanager
from decimal import Decimal

import frappe
from pymysql.constants import FIELD_TYPE

from sanawbar.business_export.engine import SCHEMA, ExportError, references


@contextmanager
def snapshot_reader():
	if frappe.conf.get("db_type", "mariadb") != "mariadb":
		raise ExportError("Source database must be MariaDB")
	connection = frappe.db.get_connection()
	# Frappe overrides NEWDECIMAL with float; do not lose cents or significant digits.
	connection.decoders[FIELD_TYPE.DECIMAL] = Decimal
	connection.decoders[FIELD_TYPE.NEWDECIMAL] = Decimal
	try:
		with connection.cursor() as cursor:
			cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
			cursor.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
			cursor.execute("SELECT UTC_TIMESTAMP(6)")
			timestamp = cursor.fetchone()[0].isoformat() + "Z"
			yield Reader(cursor), timestamp
	finally:
		connection.rollback()
		connection.close()


class Reader:
	def __init__(self, cursor):
		self.cursor = cursor
		self.columns = {}
		self.missing = []

	def fields(self, dt):
		if dt not in self.columns:
			self.cursor.execute(
				"SELECT COLUMN_NAME FROM information_schema.COLUMNS "
				"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
				("tab" + dt,),
			)
			self.columns[dt] = {r[0] for r in self.cursor.fetchall()}
			if self.columns[dt]:
				self.cursor.execute(
					"SELECT ENGINE FROM information_schema.TABLES "
					"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
					("tab" + dt,),
				)
				if self.cursor.fetchone()[0] != "InnoDB":
					raise ExportError("Business tables must use InnoDB")
		return self.columns[dt]

	def read(self, dt, field=None, values=None, parent=None):
		spec = SCHEMA[dt]
		available = self.fields(dt)
		if not available:
			return []
		if field and field not in available:
			raise ExportError("Missing ownership column")
		projection = ", ".join(f"`{f}`" if f in available else f"NULL AS `{f}`" for f in spec["fields"])
		where, args = [], []
		if field:
			if not values:
				return []
			where.append(f"`{field}` IN ({', '.join(['%s'] * len(values))})")
			args.extend(values)
		if parent:
			where += ["`parenttype` = %s", "`parentfield` = %s"]
			args.extend(parent)
		query = f"SELECT {projection} FROM `tab{dt}`"
		if where:
			query += " WHERE " + " AND ".join(where)
		self.cursor.execute(query, tuple(args))
		return [dict(zip(spec["fields"], r, strict=True)) for r in self.cursor.fetchall()]

	@staticmethod
	def set_reference(row, field, canonical):
		if row.get(field) != canonical:
			row.setdefault("_original_refs", {}).setdefault(field, row[field])
			row[field] = canonical

	def resolve_parent(self, row, parent_dt, parents, resolved):
		name = row["parent"]
		if name in parents:
			return
		key = (parent_dt, name)
		if key not in resolved:
			found = self.read(parent_dt, "name", [name])
			resolved[key] = found[0]["name"] if found else None
		canonical = resolved[key]
		if canonical not in parents:
			raise ExportError("Child relationship crosses export scope")
		self.set_reference(row, "parent", canonical)

	def collect(self, scope):
		if not self.fields("Company"):
			raise ExportError("ERPNext business tables are unavailable")
		# Dynamic configuration is inspected solely to reject unsupported dimensions, never exported.
		self.cursor.execute("SELECT fieldname, document_type FROM `tabAccounting Dimension` ")
		for field, target in self.cursor.fetchall():
			if (field, target) not in (
				("branch", "Branch"),
				("project", "Project"),
				("cost_center", "Cost Center"),
			):
				raise ExportError("Unsupported accounting dimension")
		rows = {dt: {} for dt in SCHEMA}
		all_companies = {r["name"] for r in self.read("Company")}
		if not scope or not set(scope) <= all_companies:
			raise ExportError("Invalid company scope")
		for dt, spec in SCHEMA.items():
			if spec["company_scoped"] and not spec["child"] and not spec.get("reference_only"):
				for row in self.read(dt, "name" if dt == "Company" else "company", scope):
					rows[dt][row["name"]] = row
		if set(scope) == all_companies:
			for dt, spec in SCHEMA.items():
				if dt not in ("Customer", "Branch") and not spec.get("site_master"):
					continue
				if spec["child"]:
					continue
				rows[dt] = {r["name"]: r for r in self.read(dt)}
		# Follow only hard-coded business links and child relationships to a fixed point.
		resolved, seen_parents = {}, set()
		while True:
			changed = False
			for dt, spec in SCHEMA.items():
				if not spec["child"]:
					continue
				for parent_dt, parent_field in spec["parents"]:
					ids = [n for n in rows[parent_dt] if (dt, parent_dt, parent_field, n) not in seen_parents]
					for offset in range(0, len(ids), 500):
						batch = ids[offset : offset + 500]
						for row in self.read(dt, "parent", batch, (parent_dt, parent_field)):
							if dt == "Dynamic Link" and row.get("link_doctype") not in SCHEMA:
								continue
							if spec["company_scoped"] and row.get("company") not in scope:
								continue
							self.resolve_parent(row, parent_dt, rows[parent_dt], resolved)
							if row["name"] not in rows[dt]:
								rows[dt][row["name"]] = row
								changed = True
						seen_parents.update((dt, parent_dt, parent_field, n) for n in batch)
			for dt in SCHEMA:
				for row in list(rows[dt].values()):
					for field, target, name in references(dt, row):
						key = (target, name)
						if name in rows[target]:
							continue
						if key in resolved:
							if resolved[key] is not None:
								self.set_reference(row, field, resolved[key])
							continue
						found = self.read(target, "name", [name])
						if not found:
							resolved[key] = None
							self.missing.append(
								{
									"table": SCHEMA[dt]["table"],
									"id": row["name"],
									"field": field,
									"target_table": SCHEMA[target]["table"],
									"target_id": name,
								}
							)
							continue
						item = found[0]
						if SCHEMA[target]["company_scoped"]:
							company = item["name"] if target == "Company" else item.get("company")
							if company not in scope:
								raise ExportError("Business relationship crosses authorized company scope")
						if SCHEMA[target]["child"]:
							parent = item.get("parenttype")
							if (parent, item.get("parentfield")) not in map(tuple, SCHEMA[target]["parents"]):
								raise ExportError("Unsupported child relationship")
							self.resolve_parent(item, parent, rows[parent], resolved)
						canonical = item["name"]
						resolved[key] = canonical
						self.set_reference(row, field, canonical)
						if canonical not in rows[target]:
							rows[target][canonical] = item
							changed = True
			if not changed:
				return rows
