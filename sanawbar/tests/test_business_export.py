"""Run without a site: python -m unittest sanawbar.tests.test_business_export."""

import json
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import nullcontext
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, create_autospec, patch

import frappe
from pymysql.constants import FIELD_TYPE

from sanawbar.business_export import engine, service, snapshot


class MemoryReader(snapshot.Reader):
	def __init__(self, records):
		super().__init__(MagicMock())
		self.records = records
		self.cursor.fetchall.return_value = []

	def fields(self, dt):
		return set(engine.SCHEMA[dt]["fields"])

	def read(self, dt, field=None, values=None, parent=None):
		return [
			dict(r)
			for r in self.records.get(dt, [])
			if (not field or r.get(field) in values)
			and (not parent or (r.get("parenttype"), r.get("parentfield")) == parent)
		]


def records():
	return {
		"Company": [{"name": "A"}, {"name": "B"}],
		"Customer": [{"name": "CA"}, {"name": "CB"}, {"name": "unused"}],
		"Branch": [{"name": "BA"}, {"name": "BB"}],
		"Account": [
			{"name": "AR", "company": "A"},
			{"name": "Income", "company": "A"},
			{"name": "B-AR", "company": "B"},
		],
		"Sales Invoice": [
			{
				"name": "INV-A",
				"company": "A",
				"customer": "CA",
				"branch": "BA",
				"docstatus": 1,
				"grand_total": Decimal("123456789012345.123456789"),
				"debit_to": "AR",
			},
			{"name": "INV-B", "company": "B", "customer": "CB", "branch": "BB"},
		],
		"Sales Invoice Item": [
			{
				"name": "LINE-A",
				"parent": "INV-A",
				"parenttype": "Sales Invoice",
				"parentfield": "items",
				"idx": 1,
				"amount": Decimal("123456789012345.123456789"),
				"income_account": "Income",
			},
			{"name": "LINE-B", "parent": "INV-B", "parenttype": "Sales Invoice", "parentfield": "items"},
		],
		"GL Entry": [
			{
				"name": "GL1",
				"company": "A",
				"account": "AR",
				"voucher_type": "Sales Invoice",
				"voucher_no": "INV-A",
				"debit": Decimal("123456789012345.123456789"),
				"credit": Decimal("0.000000000"),
				"is_cancelled": 0,
			},
			{
				"name": "GL2",
				"company": "A",
				"account": "Income",
				"voucher_type": "Sales Invoice",
				"voucher_no": "INV-A",
				"credit": Decimal("123456789012345.123456789"),
				"debit": Decimal("0.000000000"),
				"is_cancelled": 0,
			},
		],
	}


class TestDataset(unittest.TestCase):
	def test_database_equivalent_references_join_and_keep_original_spelling(self):
		class CollationReader(MemoryReader):
			def read(self, dt, field=None, values=None, parent=None):
				def equivalent(left, right):
					if isinstance(left, str) and isinstance(right, str):
						return left.rstrip(" ").casefold() == right.rstrip(" ").casefold()
					return left == right

				return [
					dict(row)
					for row in self.records.get(dt, [])
					if (not field or any(equivalent(row.get(field), v) for v in values))
					and (not parent or (row.get("parenttype"), row.get("parentfield")) == parent)
				]

		data = records()
		data["Item"] = [{"name": "Product"}]
		data["UOM Conversion Detail"] = [
			{
				"name": "UNIT",
				"parent": "Product ",
				"parenttype": "Item",
				"parentfield": "uoms",
			}
		]
		data["Sales Invoice Item"][0]["item_code"] = "PRODUCT "
		for row in data["GL Entry"]:
			row["voucher_no"] = "inv-a "
		reader = CollationReader(data)
		rows = reader.collect(["A"])
		self.assertFalse(reader.missing)
		self.assertEqual(set(rows["Item"]), {"Product"})
		self.assertEqual(rows["UOM Conversion Detail"]["UNIT"]["parent"], "Product")
		with tempfile.TemporaryDirectory() as directory:
			engine.write_package(directory, rows, "2026-10-15T00:00:00Z", ["A"])
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript((Path(directory) / "business-data.sql").read_text())
			self.assertEqual(
				conn.execute(
					"SELECT u.raw_refs FROM product_units u JOIN products p ON u.parent_id=p.id"
				).fetchone(),
				('{"parent_id": "Product "}',),
			)
			self.assertEqual(
				conn.execute("SELECT COUNT(*) FROM gl_rows g JOIN sales_bills b ON g.vch_id=b.id").fetchone(),
				(2,),
			)
			self.assertEqual(
				conn.execute("SELECT raw_refs FROM gl_rows WHERE id='GL1'").fetchone(),
				('{"vch_id": "inv-a "}',),
			)

	def test_reference_originals_cannot_export_unapproved_fields(self):
		with self.assertRaises(engine.ExportError):
			engine.original_reference_values("Customer", {"_original_refs": {"password": "secret"}})

	def test_company_isolation_and_child_ownership(self):
		rows = MemoryReader(records()).collect(["A"])
		self.assertEqual(set(rows["Company"]), {"A"})
		self.assertEqual(set(rows["Customer"]), {"CA"})
		self.assertEqual(set(rows["Branch"]), {"BA"})
		self.assertEqual(set(rows["Sales Invoice Item"]), {"LINE-A"})
		self.assertNotIn("B-AR", rows["Account"])

	def test_site_wide_scope_includes_unreferenced_customers_and_branches(self):
		rows = MemoryReader(records()).collect(["A", "B"])
		self.assertIn("unused", rows["Customer"])
		self.assertEqual(set(rows["Branch"]), {"BA", "BB"})

	def test_site_masters_and_new_business_children_keep_company_boundary(self):
		data = records()
		data["Item"] = [{"name": "unused-item"}]
		data["Supplier"] = [{"name": "unused-supplier"}]
		data["POS Closing Entry"] = [
			{"name": "CLOSE-A", "company": "A"},
			{"name": "CLOSE-B", "company": "B"},
		]
		data["POS Closing Entry Detail"] = [
			{
				"name": "PAY-A",
				"parent": "CLOSE-A",
				"parenttype": "POS Closing Entry",
				"parentfield": "payment_reconciliation",
				"closing_amount": Decimal("12.30"),
			},
			{
				"name": "PAY-B",
				"parent": "CLOSE-B",
				"parenttype": "POS Closing Entry",
				"parentfield": "payment_reconciliation",
			},
		]
		limited = MemoryReader(data).collect(["A"])
		self.assertEqual(set(limited["POS Closing Entry Detail"]), {"PAY-A"})
		self.assertFalse(limited["Item"])
		self.assertFalse(limited["Supplier"])
		all_rows = MemoryReader(data).collect(["A", "B"])
		self.assertIn("unused-item", all_rows["Item"])
		self.assertIn("unused-supplier", all_rows["Supplier"])

	def test_dynamic_document_types_use_neutral_export_names(self):
		c = engine.column_name
		data = records()
		data["Stock Ledger Entry"] = [
			{
				"name": "SLE-A",
				"company": "A",
				"voucher_type": "Sales Invoice",
				"voucher_no": "INV-A",
				"actual_qty": Decimal("-1.25"),
			}
		]
		rows = MemoryReader(data).collect(["A"])
		with tempfile.TemporaryDirectory() as directory:
			path, _ = engine.write_package(directory, rows, "2026-10-14T00:00:00Z", ["A"])
			with zipfile.ZipFile(path) as archive:
				sql = archive.read("business-data.sql").decode()
			self.assertNotIn("Sales Invoice", sql)
			self.assertNotIn("Stock Ledger Entry", sql)
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript(sql)
			self.assertEqual(
				conn.execute(
					f"SELECT {c('Stock Ledger Entry', 'voucher_type')}, {c('Stock Ledger Entry', 'voucher_no')}, {c('Stock Ledger Entry', 'actual_qty')} FROM stock_gl_rows"
				).fetchone(),
				("sales_bills", "INV-A", "-1.25"),
			)

	def test_custom_child_collection_names_do_not_leak_application_fields(self):
		c = engine.column_name
		rows = {
			"POS Closing Entry": {"C": {"name": "C", "company": "A"}},
			"URY POS Closing Cashier Summary": {
				"S": {
					"name": "S",
					"parent": "C",
					"parenttype": "POS Closing Entry",
					"parentfield": "custom_cashier_summary",
					"payment_amount": Decimal("9.50"),
				}
			},
		}
		with tempfile.TemporaryDirectory() as directory:
			path, _ = engine.write_package(directory, rows, "2026-10-14T00:00:00Z", ["A"])
			with zipfile.ZipFile(path) as archive:
				sql = archive.read("business-data.sql").decode()
			self.assertNotIn("custom_cashier_summary", sql)
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript(sql)
			self.assertEqual(
				conn.execute(
					f"SELECT {c('URY POS Closing Cashier Summary', 'parenttype')}, {c('URY POS Closing Cashier Summary', 'parentfield')}, {c('URY POS Closing Cashier Summary', 'payment_amount')} FROM till_cashier_totals"
				).fetchone(),
				("till_closings", "till_cashier_totals", "9.50"),
			)

	def test_cross_company_reference_fails_instead_of_leaking(self):
		data = records()
		data["Sales Invoice"][0]["debit_to"] = "B-AR"
		with self.assertRaises(engine.ExportError):
			MemoryReader(data).collect(["A"])

	def test_landed_costs_reference_the_actual_purchase_line_type(self):
		data = records()
		data["Landed Cost Voucher"] = [{"name": "LC", "company": "A"}]
		data["Landed Cost Item"] = []
		for kind in ("Purchase Invoice", "Purchase Receipt"):
			data[kind] = [{"name": kind, "company": "A"}]
			data[kind + " Item"] = [
				{
					"name": kind + "-line",
					"parent": kind,
					"parenttype": kind,
					"parentfield": "items",
				}
			]
			data["Landed Cost Item"].append(
				{
					"name": kind + "-cost",
					"parent": "LC",
					"parenttype": "Landed Cost Voucher",
					"parentfield": "items",
					"receipt_document_type": kind,
					"receipt_document": kind,
					"purchase_receipt_item": kind + "-line",
					"applicable_charges": Decimal("5.250000000"),
				}
			)
		reader = MemoryReader(data)
		rows = reader.collect(["A"])
		self.assertFalse(reader.missing)
		c = engine.column_name
		with tempfile.TemporaryDirectory() as directory:
			engine.write_package(directory, rows, "2026-10-15T00:00:00Z", ["A"])
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript((Path(directory) / "business-data.sql").read_text())
			for kind, parent_table, line_table in (
				("Purchase Invoice", "vendor_bills", "vendor_bill_lines"),
				("Purchase Receipt", "goods_receipts", "goods_rcpt_lines"),
			):
				matched = conn.execute(
					f'SELECT l.id FROM landed_lines l JOIN "{line_table}" i '
					f'ON l."{c("Landed Cost Item", "purchase_receipt_item")}"=i.id '
					f'WHERE l."{c("Landed Cost Item", "receipt_document_type")}"=?',
					(parent_table,),
				).fetchall()
				self.assertEqual(matched, [(kind + "-cost",)])

	def test_stock_additional_costs_are_actual_source_fields_and_rows(self):
		data = records()
		data["Stock Entry"] = [{"name": "ST", "company": "A", "total_additional_costs": Decimal("3.500")}]
		data["Landed Cost Taxes and Charges"] = [
			{
				"name": "COST",
				"parent": "ST",
				"parenttype": "Stock Entry",
				"parentfield": "additional_costs",
				"amount": Decimal("3.500"),
			}
		]
		rows = MemoryReader(data).collect(["A"])
		with tempfile.TemporaryDirectory() as directory:
			engine.write_package(directory, rows, "2026-10-15T00:00:00Z", ["A"])
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript((Path(directory) / "business-data.sql").read_text())
			alias = engine.column_name("Stock Entry", "total_additional_costs")
			self.assertEqual(conn.execute(f'SELECT "{alias}" FROM stock_moves').fetchone(), ("3.500",))
			self.assertEqual(
				conn.execute("SELECT parent_id, parent_tbl FROM landed_charges").fetchone(),
				("ST", "stock_moves"),
			)

	def test_unknown_voucher_and_dimension_fail_closed(self):
		data = records()
		data["GL Entry"][0]["voucher_type"] = "Secret Custom Voucher"
		with self.assertRaises(engine.ExportError):
			MemoryReader(data).collect(["A"])
		reader = MemoryReader(records())
		reader.cursor.fetchall.return_value = [("custom_dimension", "Secret Data")]
		with self.assertRaises(engine.ExportError):
			reader.collect(["A"])

	def test_deleted_reference_is_reported_and_not_synthesized(self):
		data = records()
		data["Sales Invoice"][0]["customer"] = "deleted"
		reader = MemoryReader(data)
		rows = reader.collect(["A"])
		self.assertNotIn("deleted", rows["Customer"])
		self.assertEqual(reader.missing[0]["target_id"], "deleted")

	def test_sql_import_exact_decimals_relationships_and_accounting(self):
		c = engine.column_name
		rows = MemoryReader(records()).collect(["A"])
		rows["Customer"]["CA"]["customer_name"] = "عربي'; DROP TABLE orgs; --\\\x00\n"
		rows["Customer"]["CA"]["disabled"] = False
		rows["Customer"]["CA"]["password"] = "SECRET NEVER EXPORT"
		with tempfile.TemporaryDirectory() as directory:
			path, manifest = engine.write_package(directory, rows, "2026-10-14T00:00:00Z", ["A"])
			with zipfile.ZipFile(path) as archive:
				self.assertEqual(set(archive.namelist()), {"business-data.sql"})
				sql = archive.read("business-data.sql").decode()
				for filename, checksum in manifest["checksums"].items():
					self.assertEqual(engine.hashlib.sha256(archive.read(filename)).hexdigest(), checksum)
			self.assertNotIn("SECRET NEVER EXPORT", sql)
			self.assertNotIn('"grand_total"', sql)
			self.assertNotIn('"customer_name"', sql)
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript(sql)
			value = conn.execute(
				f"SELECT {c('Customer', 'customer_name')}, {c('Customer', 'disabled')}, {c('Customer', 'tax_id')} FROM clients"
			).fetchone()
			self.assertEqual(value, (rows["Customer"]["CA"]["customer_name"], "0", None))
			line = conn.execute(
				f"SELECT i.{c('Sales Invoice', 'grand_total')}, l.{c('Sales Invoice Item', 'amount')} FROM sales_bills i JOIN sales_bill_lines l ON l.{c('Sales Invoice Item', 'parent')}=i.{c('Sales Invoice', 'name')}"
			).fetchone()
			self.assertEqual(line, ("123456789012345.123456789",) * 2)
			amounts = conn.execute(
				f'SELECT {c("GL Entry", "debit")}, {c("GL Entry", "credit")} FROM gl_rows WHERE {c("GL Entry", "is_cancelled")}="0"'
			).fetchall()
			self.assertEqual(sum(Decimal(d) - Decimal(c) for d, c in amounts), 0)
			self.assertEqual(
				conn.execute(
					f"SELECT COUNT(*) FROM gl_rows g JOIN sales_bills i ON g.{c('GL Entry', 'voucher_no')}=i.{c('Sales Invoice', 'name')} JOIN accts a ON g.{c('GL Entry', 'account')}=a.{c('Account', 'name')}"
				).fetchone()[0],
				2,
			)

	def test_cancellations_zero_and_document_status_are_retained(self):
		data = records()
		data["Sales Invoice"][0]["docstatus"] = 2
		data["GL Entry"][0]["is_cancelled"] = 1
		rows = MemoryReader(data).collect(["A"])
		self.assertEqual(rows["Sales Invoice"]["INV-A"]["docstatus"], 2)
		self.assertEqual(rows["GL Entry"]["GL1"]["is_cancelled"], 1)
		self.assertNotEqual(engine.literal(0), "NULL")
		self.assertNotEqual(engine.literal(False), "NULL")

	def test_closed_allowlist_excludes_tracking_metadata_and_secrets(self):
		for dt in (
			"User",
			"Role",
			"DocType",
			"File",
			"Backup export",
			"Integration Request",
			"Custom Field",
			"Server Script",
			"Workflow",
		):
			self.assertNotIn(dt, engine.SCHEMA)
		for spec in engine.SCHEMA.values():
			for field in ("password", "api_key", "api_secret", "owner", "modified_by", "portal_users"):
				self.assertNotIn(field, spec["fields"])
		for dt, excluded in {
			"EV Charging Session": ("card_fingerprint", "collected_by", "pos_invoice_error"),
			"URY POS Closing Cashier Summary": ("cashier",),
			"POS Closing Entry": ("user", "pos_profile", "error_message"),
			"URY Room": ("printer_settings",),
			"Bank Account": ("integration_id", "last_integration_date"),
			"Contact": ("user", "google_contacts_id", "sync_with_google_contacts"),
		}.items():
			for field in excluded:
				self.assertNotIn(field, engine.SCHEMA[dt]["fields"])

	def test_every_sql_column_has_a_short_unique_alias(self):
		table_names = [spec["table"] for spec in engine.SCHEMA.values()]
		self.assertEqual(len(table_names), len(set(table_names)))
		self.assertTrue(all(len(name) <= 22 for name in table_names))
		self.assertEqual(engine.SCHEMA["Sales Invoice"]["table"], "sales_bills")
		self.assertEqual(engine.SCHEMA["Stock Ledger Entry"]["table"], "stock_gl_rows")
		for dt, spec in engine.SCHEMA.items():
			self.assertEqual(len(spec["fields"]), len(spec["columns"]))
			self.assertEqual(len(spec["columns"]), len(set(spec["columns"])))
			for field, alias in zip(spec["fields"], spec["columns"], strict=True):
				self.assertEqual(engine.column_name(dt, field), alias)
				self.assertLessEqual(len(alias), 24)
				self.assertNotRegex(alias, r"^c\d+$")
			self.assertEqual(spec["columns"][0], "id")
		self.assertEqual(engine.column_name("Sales Invoice", "grand_total"), "grand_amt")
		self.assertEqual(engine.column_name("Sales Invoice", "total_taxes_and_charges"), "total_tax_chgs")

	def test_reader_projection_is_closed_and_missing_values_are_null(self):
		cursor = MagicMock()
		cursor.fetchall.return_value = [
			("C", None, None, None, None, None, None, None, None, None, None, None)
		]
		reader = snapshot.Reader(cursor)
		reader.columns["Company"] = {"name", "new_secret"}
		cursor.fetchall.return_value = [tuple(["C"] + [None] * (len(engine.SCHEMA["Company"]["fields"]) - 1))]
		row = reader.read("Company", "name", ["C"])[0]
		query, args = cursor.execute.call_args.args
		self.assertNotIn("SELECT *", query)
		self.assertNotIn("new_secret", query)
		self.assertIn("NULL AS `company_name`", query)
		self.assertEqual(args, ("C",))
		self.assertIsNone(row["company_name"])

	def test_snapshot_connection_is_read_only_site_local_and_decimal_safe(self):
		connection = MagicMock()
		connection.decoders = {}
		cursor = connection.cursor.return_value.__enter__.return_value
		cursor.fetchone.return_value = [datetime(2026, 10, 14)]  # noqa: DTZ001 - database UTC is naive
		fake = SimpleNamespace(conf={}, db=SimpleNamespace(get_connection=lambda: connection))
		with patch.object(snapshot, "frappe", fake), snapshot.snapshot_reader() as (_, timestamp):
			self.assertEqual(timestamp, "2026-10-14T00:00:00Z")
			self.assertIs(connection.decoders[FIELD_TYPE.NEWDECIMAL], Decimal)
		statements = [c.args[0] for c in cursor.execute.call_args_list]
		self.assertEqual(
			statements[:2],
			[
				"SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ",
				"START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
			],
		)
		connection.rollback.assert_called_once()
		connection.close.assert_called_once()


class TestSecurityAndLifecycle(unittest.TestCase):
	def setUp(self):
		self.directory = tempfile.TemporaryDirectory()
		self.addCleanup(self.directory.cleanup)
		self.fake = MagicMock()
		self.fake.session.user = "alice"
		self.fake.PermissionError = frappe.PermissionError
		self.fake.throw.side_effect = frappe.PermissionError
		self.fake.db.get_value.return_value = 1
		self.fake.has_permission = create_autospec(frappe.has_permission, return_value=True)
		self.fake.get_site_path.side_effect = lambda *parts: str(Path(self.directory.name).joinpath(*parts))
		self.fake.get_all.side_effect = self.get_all
		self.roles = [service.ROLE]
		self.companies = ["A"]
		self.doc = MagicMock()
		self.doc.name = "a123456789"
		self.doc.requester = "alice"
		self.doc.company_scope = '["A"]'
		self.doc.scope_key = service.scope_key(["A"])
		self.doc.is_new.return_value = False
		self.doc.status = "Queued"
		self.doc.requested_at = service.utcnow()
		self.doc.expires_at = service.utcnow() + timedelta(hours=24)
		self.doc.permission_index = "{}"
		self.fake.get_doc.return_value = self.doc
		self.addCleanup(patch.stopall)
		patch.object(frappe.local, "flags", SimpleNamespace(in_test=False), create=True).start()
		patch.object(service, "frappe", self.fake).start()
		patch.object(service, "_", lambda s: s).start()
		patch.object(service, "get_system_timezone", return_value="Asia/Amman").start()
		patch.object(service, "scope_lock", lambda *a, **kw: nullcontext()).start()

	def get_all(self, dt, **kwargs):
		if dt == "Has Role":
			return self.roles
		if dt == "Company":
			return self.companies
		return []

	def test_list_permission_query_requires_only_export_role(self):
		self.fake.has_permission.side_effect = AssertionError("Unexpected document permission check")
		self.assertEqual(service.permission_query("alice"), "1=1")
		self.roles = []
		self.assertEqual(service.permission_query("alice"), "1=0")

	def test_new_form_can_be_read_without_requester_or_scope(self):
		self.doc.is_new.return_value = True
		self.doc.requester = None
		self.doc.company_scope = None
		self.fake.flags.mute_messages = False
		self.assertTrue(service.has_permission(self.doc, user="alice", ptype="read"))
		self.fake.throw.assert_not_called()
		self.assertFalse(self.fake.flags.mute_messages)
		self.assertFalse(service.has_permission(self.doc, user="alice", ptype="write"))
		self.assertFalse(service.has_permission(self.doc, user="alice", ptype="create"))
		self.roles = []
		self.assertFalse(service.has_permission(self.doc, user="alice", ptype="read"))
		self.assertFalse(self.fake.flags.mute_messages)

	def test_saved_form_allows_other_requesters_but_keeps_site_scope(self):
		self.doc.requester = "bob"
		self.assertTrue(service.has_permission(self.doc, user="alice", ptype="read"))
		self.doc.company_scope = '["B"]'
		self.assertFalse(service.has_permission(self.doc, user="alice", ptype="read"))

	def test_system_manager_alone_cannot_request_or_download(self):
		self.roles = ["System Manager"]
		for call in (service.create_export, lambda: service.download(self.doc.name)):
			with self.assertRaises(frappe.PermissionError):
				call()
		self.fake.enqueue.assert_not_called()

	def test_guest_disabled_user_and_no_accessible_company_denied(self):
		self.fake.session.user = "Guest"
		with self.assertRaises(frappe.PermissionError):
			service.authorized_scope()
		self.fake.session.user = "alice"
		self.fake.db.get_value.return_value = 0
		with self.assertRaises(frappe.PermissionError):
			service.authorized_scope()
		self.fake.db.get_value.return_value = 1
		self.companies = []
		with self.assertRaises(frappe.PermissionError):
			service.authorized_scope()

	def test_role_holder_can_export_without_company_user_permissions(self):
		self.assertEqual(service.authorized_scope(), ["A"])
		self.assertNotIn("User Permission", [call.args[0] for call in self.fake.get_all.call_args_list])

	def test_export_role_grants_all_current_site_companies(self):
		self.companies = ["B", "A"]
		self.fake.has_permission.side_effect = AssertionError("Unexpected document permission check")
		self.assertEqual(service.authorized_scope(), ["A", "B"])

	def test_scope_denials_explain_the_missing_requirement(self):
		self.companies = []
		with self.assertRaises(frappe.PermissionError):
			service.authorized_scope()
		self.assertIn("no companies", self.fake.throw.call_args.args[0])
		self.companies = ["A"]
		self.roles = []
		with self.assertRaises(frappe.PermissionError):
			service.authorized_scope()
		self.assertIn("explicitly assigned", self.fake.throw.call_args.args[0])

	def test_export_with_company_outside_current_site_is_denied(self):
		self.doc.status = "Ready"
		self.companies = ["B"]
		with self.assertRaises(frappe.PermissionError):
			service.download(self.doc.name)

	def test_expired_or_incomplete_download_denied_before_file_read(self):
		for status in ("Queued", "Running", "Failed", "Expired"):
			self.doc.status = status
			with self.assertRaises(frappe.PermissionError):
				service.download(self.doc.name)
		self.doc.status = "Ready"
		self.doc.expires_at = service.utcnow() - timedelta(seconds=1)
		with self.assertRaises(frappe.PermissionError):
			service.download(self.doc.name)

	def test_duplicate_request_does_not_enqueue(self):
		self.fake.get_all.side_effect = lambda dt, **kw: (
			["active"] if dt == service.DOCTYPE and kw.get("pluck") == "name" else self.get_all(dt, **kw)
		)
		with self.assertRaises(frappe.PermissionError):
			service.create_export()
		self.fake.enqueue.assert_not_called()

	def test_export_quota_blocks_before_insertion_or_queueing(self):
		now = service.utcnow()
		self.fake.get_all.side_effect = lambda dt, **kw: (
			[now - timedelta(hours=1)]
			if dt == service.DOCTYPE and kw.get("pluck") == "requested_at"
			else self.get_all(dt, **kw)
		)
		with self.assertRaises(frappe.PermissionError):
			service.create_export()
		self.fake.get_doc.assert_not_called()
		self.fake.enqueue.assert_not_called()
		query = next(
			call.kwargs for call in self.fake.get_all.call_args_list if call.args[0] == service.DOCTYPE
		)
		self.assertEqual(set(query["filters"]), {"requested_at"})
		self.assertEqual(query["limit"], 2)

	def test_rolling_quota_boundaries(self):
		now = service.utcnow()
		self.assertEqual(service.next_export_time([], now), now)
		self.assertGreater(service.next_export_time([now - timedelta(hours=23)], now), now)
		self.assertEqual(service.next_export_time([now - timedelta(hours=24)], now), now)
		self.assertGreater(
			service.next_export_time([now - timedelta(days=2), now - timedelta(days=6)], now), now
		)
		self.assertEqual(
			service.next_export_time([now - timedelta(days=2), now - timedelta(days=7)], now), now
		)

	def test_queue_failure_marks_failed(self):
		self.doc.insert.return_value = self.doc
		self.fake.enqueue.side_effect = RuntimeError("secret connection string")
		with self.assertRaises(frappe.PermissionError):
			service.create_export()
		self.assertEqual(self.doc.status, "Failed")
		self.assertNotIn("secret", self.doc.error_message)
		self.assertIsNone(self.doc.private_export_file)

	def test_worker_rechecks_role_and_does_not_start_snapshot_when_revoked(self):
		self.roles = []
		with patch.object(service, "snapshot_reader") as reader:
			service.generate(self.doc.name)
			reader.assert_not_called()
		self.assertEqual(self.doc.status, "Failed")

	def test_success_and_duplicate_worker(self):
		self.fake.has_permission.side_effect = AssertionError("Unexpected document permission check")
		reader = MemoryReader(records())
		with patch.object(
			service, "snapshot_reader", return_value=nullcontext((reader, "2026-10-14T00:00:00Z"))
		):
			service.generate(self.doc.name)
		self.assertEqual(self.doc.status, "Ready")
		self.assertTrue(service.artifact_path(self.doc).is_file())
		self.assertEqual(self.doc.checksum, engine.sha256_file(service.artifact_path(self.doc)))
		self.assertLess(abs((self.doc.expires_at - service.utcnow()).total_seconds() - 86400), 10)
		with patch.object(service, "snapshot_reader") as reader:
			service.generate(self.doc.name)
			reader.assert_not_called()

	def test_failure_after_file_publication_deletes_artifact(self):
		reader = MemoryReader(records())
		self.doc.save.side_effect = [None, RuntimeError("secret"), None]
		with patch.object(
			service, "snapshot_reader", return_value=nullcontext((reader, "2026-10-14T00:00:00Z"))
		):
			service.generate(self.doc.name)
		self.assertEqual(self.doc.status, "Failed")
		self.assertFalse(service.artifact_path(self.doc).exists())
		self.assertIsNone(self.doc.private_export_file)

	def test_expiry_deletes_zip_and_preserves_history(self):
		self.doc.status = "Ready"
		self.doc.expires_at = service.utcnow() - timedelta(seconds=1)
		path = service.artifact_path(self.doc)
		path.write_bytes(b"zip")
		self.fake.get_all.side_effect = lambda *a, **kw: [self.doc.name]
		service.cleanup()
		self.assertFalse(path.exists())
		self.assertEqual(self.doc.status, "Expired")
		self.doc.save.assert_called()

	def test_stalled_job_recovers_and_removes_partial_files(self):
		self.doc.status = "Running"
		self.doc.requested_at = service.utcnow() - timedelta(hours=3)
		service.artifact_path(self.doc).write_bytes(b"partial")
		self.fake.get_all.side_effect = lambda *a, **kw: [self.doc.name]
		service.cleanup()
		self.assertEqual(self.doc.status, "Failed")
		self.assertFalse(service.artifact_path(self.doc).exists())

	def test_download_rechecks_export_role(self):
		self.doc.status = "Ready"
		self.roles = []
		with self.assertRaises(frappe.PermissionError):
			service.download(self.doc.name)

	def test_latest_status_is_minimal_and_requires_role(self):
		self.fake.get_all.side_effect = lambda dt, **kw: (
			[self.doc.name] if dt == service.DOCTYPE else self.get_all(dt, **kw)
		)
		self.doc.status = "Ready"
		self.assertEqual(service.latest_export(), {"name": self.doc.name, "status": "Ready"})
		self.doc.expires_at = service.utcnow() - timedelta(seconds=1)
		self.assertEqual(service.latest_export()["status"], "Expired")
		self.roles = []
		with self.assertRaises(frappe.PermissionError):
			service.latest_export()

	def test_latest_status_without_exports(self):
		self.assertIsNone(service.latest_export())

	def test_path_traversal_is_rejected(self):
		self.doc.name = "../../other-site/private/secret"
		with self.assertRaises(engine.ExportError):
			service.artifact_path(self.doc)

	def test_request_uses_authenticated_scope_and_queues_once(self):
		self.fake.has_permission.side_effect = AssertionError("Unexpected document permission check")
		self.doc.insert.return_value = self.doc
		self.assertEqual(service.create_export(), self.doc.name)
		values = self.fake.get_doc.call_args.args[0]
		self.assertEqual(values["requester"], "alice")
		self.assertEqual(json.loads(values["company_scope"]), ["A"])
		self.fake.enqueue.assert_called_once()

	def test_role_revocation_before_publication_removes_staged_output(self):
		def package_then_revoke(*args, **kwargs):
			result = engine.write_package(*args, **kwargs)
			self.roles = []
			return result

		reader = MemoryReader(records())
		with (
			patch.object(
				service, "snapshot_reader", return_value=nullcontext((reader, "2026-10-14T00:00:00Z"))
			),
			patch.object(service, "write_package", side_effect=package_then_revoke),
		):
			service.generate(self.doc.name)
		self.assertEqual(self.doc.status, "Failed")
		self.assertEqual(list(service.storage().iterdir()), [])

	def test_authorized_download_has_private_no_store_response(self):
		self.doc.requester = "another-exporter"
		self.fake.has_permission.side_effect = AssertionError("Unexpected document permission check")
		from werkzeug.wrappers import Response

		self.doc.status = "Ready"
		path = service.artifact_path(self.doc)
		path.write_bytes(b"complete archive")
		self.doc.checksum = engine.sha256_file(path)
		self.doc.private_export_file = path.name
		with patch(
			"frappe.utils.response.build_response",
			side_effect=lambda *a: Response(self.fake.local.response.filecontent),
		):
			response = service.download(self.doc.name)
		self.assertEqual(response.data, b"complete archive")
		self.assertEqual(response.headers["Cache-Control"], "no-store, private")
		self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

	def test_download_rechecks_expiry_after_expensive_checks(self):
		now = service.utcnow()
		self.doc.status = "Ready"
		self.doc.expires_at = now + timedelta(seconds=1)
		path = service.artifact_path(self.doc)
		path.write_bytes(b"archive")
		self.doc.checksum = engine.sha256_file(path)
		self.doc.private_export_file = path.name
		with (
			patch.object(service, "utcnow", side_effect=[now, now + timedelta(seconds=2)]),
			self.assertRaises(frappe.PermissionError),
		):
			service.download(self.doc.name)

	def test_corrupted_archive_is_not_downloadable(self):
		self.doc.status = "Ready"
		path = service.artifact_path(self.doc)
		path.write_bytes(b"corrupted")
		self.doc.checksum = "wrong"
		self.doc.private_export_file = path.name
		with self.assertRaises(frappe.PermissionError):
			service.download(self.doc.name)


class TestAdditionalContracts(unittest.TestCase):
	def test_payment_allocation_and_outstanding_reconcile_after_sql_import(self):
		c = engine.column_name
		data = records()
		data["Sales Invoice"][0].update(
			grand_total=Decimal("100.0000"), outstanding_amount=Decimal("87.6600")
		)
		data["Payment Entry"] = [
			{
				"name": "PAY",
				"company": "A",
				"party_type": "Customer",
				"party": "CA",
				"paid_amount": Decimal("12.3400"),
				"total_allocated_amount": Decimal("12.3400"),
			}
		]
		data["Payment Entry Reference"] = [
			{
				"name": "ALLOC",
				"parenttype": "Payment Entry",
				"parentfield": "references",
				"parent": "PAY",
				"reference_doctype": "Sales Invoice",
				"reference_name": "INV-A",
				"allocated_amount": Decimal("12.3400"),
			}
		]
		data["Payment Ledger Entry"] = [
			{
				"name": "PLE1",
				"company": "A",
				"voucher_type": "Sales Invoice",
				"voucher_no": "INV-A",
				"amount": Decimal("100.0000"),
				"delinked": 0,
			},
			{
				"name": "PLE2",
				"company": "A",
				"voucher_type": "Payment Entry",
				"voucher_no": "PAY",
				"against_voucher_type": "Sales Invoice",
				"against_voucher_no": "INV-A",
				"amount": Decimal("-12.3400"),
				"delinked": 0,
			},
		]
		rows = MemoryReader(data).collect(["A"])
		with tempfile.TemporaryDirectory() as directory:
			engine.write_package(directory, rows, "2026-10-14T00:00:00Z", ["A"])
			conn = sqlite3.connect(":memory:")
			self.addCleanup(conn.close)
			conn.executescript((Path(directory) / "business-data.sql").read_text())
			invoice, outstanding, allocated, paid = conn.execute(
				f"SELECT i.{c('Sales Invoice', 'grand_total')}, i.{c('Sales Invoice', 'outstanding_amount')}, a.{c('Payment Entry Reference', 'allocated_amount')}, p.{c('Payment Entry', 'paid_amount')} FROM pay_allocs a JOIN sales_bills i ON a.{c('Payment Entry Reference', 'reference_name')}=i.{c('Sales Invoice', 'name')} JOIN payments p ON a.{c('Payment Entry Reference', 'parent')}=p.{c('Payment Entry', 'name')}"
			).fetchone()
			self.assertEqual(Decimal(paid), Decimal(allocated))
			self.assertEqual(Decimal(invoice) - Decimal(allocated), Decimal(outstanding))
			ledger = conn.execute(
				f'SELECT {c("Payment Ledger Entry", "amount")} FROM settlement_rows WHERE {c("Payment Ledger Entry", "delinked")}="0"'
			).fetchall()
			self.assertEqual(sum(Decimal(r[0]) for r in ledger), Decimal(outstanding))

	def test_employee_master_is_selected_by_company(self):
		data = records()
		data["Employee"] = [
			{"name": "E1", "company": "A"},
			{"name": "E2", "company": "A"},
			{"name": "E3", "company": "B"},
		]
		data["Employee Advance"] = [{"name": "ADV", "company": "A", "employee": "E1"}]
		rows = MemoryReader(data).collect(["A"])
		self.assertEqual(set(rows["Employee"]), {"E1", "E2"})

	def test_scope_lock_is_namespaced_by_current_database(self):
		cache = MagicMock()
		fake = SimpleNamespace(cache=cache)
		with patch.object(service, "frappe", fake):
			for site in ("database_a", "database_b"):
				cache.make_key.side_effect = lambda key, site=site: (site + "|" + key).encode()
				service.scope_lock(service.scope_key(["Company"]))
		self.assertNotEqual(cache.lock.call_args_list[0].args[0], cache.lock.call_args_list[1].args[0])

	def test_tracking_document_rejects_direct_creation_edits_and_deletion(self):
		from sanawbar.sanawbar.doctype.backup_export import backup_export

		doc = object.__new__(backup_export.Backupexport)
		fake = SimpleNamespace(
			throw=MagicMock(side_effect=frappe.PermissionError), PermissionError=frappe.PermissionError
		)
		with patch.object(backup_export, "frappe", fake), patch.object(backup_export, "_", lambda s: s):
			for method in (doc.before_insert, doc.validate, doc.on_trash):
				with self.assertRaises(frappe.PermissionError):
					method()
			with service.internal_write():
				doc.validate()

	def test_frappe_base32_identifiers_work(self):
		from frappe.model.naming import make_autoname

		with patch.object(service, "storage", return_value=Path("/tmp")):
			for _ in range(100):
				self.assertEqual(
					service.artifact_path(SimpleNamespace(name=make_autoname("hash"))).suffix, ".zip"
				)


if __name__ == "__main__":
	unittest.main()
