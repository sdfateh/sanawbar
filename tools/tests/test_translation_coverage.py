"""Regression checks for literal extraction and honest dynamic reporting."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
	"coverage_check", Path(__file__).parents[1] / "check_translation_coverage.py"
)
coverage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coverage)


class TranslationCoverageTests(unittest.TestCase):
	def setUp(self):
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.root = Path(self.temp.name)
		self.app = self.root / "consumer"
		self.shared = self.root / "shared"
		for root, name in ((self.app, "consumer"), (self.shared, "shared")):
			catalogue = root / name / "translations" / "ar.json"
			catalogue.parent.mkdir(parents=True)
			catalogue.write_text(json.dumps({"Known": "معروف"}), encoding="utf-8")

	def args(self, **values):
		return argparse.Namespace(
			app=str(self.app),
			shared=str(self.shared),
			lang="ar",
			frontend=[],
			node_modules=None,
			node="node",
			manual_keys=[],
			**values,
		)

	def test_python_ast_handles_multiline_strings_and_reports_dynamic(self):
		(self.app / "api.py").write_text(
			'_("Known")\nfrappe._("Missing " "message")\n_(row.status)\n# _("Ignored comment")\n',
			encoding="utf-8",
		)
		report = coverage.audit(self.args())
		self.assertEqual(set(report["missing"]), {"Missing message"})
		self.assertEqual(report["dynamic"][0]["value"], "row.status")

	def test_literal_python_and_jinja_context_requires_specific_entry(self):
		(self.app / "api.py").write_text(
			'_("Known", context="operation")\nfrappe._("Known", None, "noun")\n_("Known", context=context_name)\nHTML = \'{{ _("Known", context="print") }}\'\n',
			encoding="utf-8",
		)
		report = coverage.audit(self.args())
		self.assertEqual(set(report["missing"]), {"Known:operation", "Known:noun", "Known:print"})
		self.assertEqual(report["dynamic"][0]["value"], "context=context_name")

	def test_native_doctype_name_and_python_metadata_labels_are_checked(self):
		(self.app / "doctype.json").write_text(
			json.dumps({"doctype": "DocType", "name": "Manufacturing Document"}), encoding="utf-8"
		)
		(self.app / "setup.py").write_text('FIELDS = [{"label": "Runtime label"}]\n', encoding="utf-8")
		self.assertEqual(
			set(coverage.audit(self.args())["missing"]), {"Manufacturing Document", "Runtime label"}
		)

	def test_shared_catalogue_is_merged_and_consumer_overrides(self):
		catalogue = self.shared / "shared" / "translations" / "ar.json"
		catalogue.write_text(json.dumps({"Shared label": "مشترك"}), encoding="utf-8")
		(self.app / "api.py").write_text('_("Shared label")\n_("Known")\n', encoding="utf-8")
		self.assertEqual(coverage.audit(self.args())["missing"], {})

	def test_metadata_select_display_options_but_not_naming_series(self):
		(self.app / "doctype.json").write_text(
			json.dumps(
				{
					"fields": [
						{
							"label": "Heading",
							"fieldname": "state",
							"fieldtype": "Select",
							"options": "Ready\nStopped\n1",
						},
						{"fieldname": "naming_series", "fieldtype": "Select", "options": "DOC-.YYYY.-"},
					]
				}
			),
			encoding="utf-8",
		)
		self.assertEqual(set(coverage.audit(self.args())["missing"]), {"Heading", "Ready", "Stopped"})

	def test_inline_jinja_literals_and_dynamic_calls_are_distinct(self):
		(self.app / "formats.py").write_text(
			"HTML = '<h1>{{ _(\"Report\") }}</h1>{{ _(doc.stock_uom) }}'\n", encoding="utf-8"
		)
		report = coverage.audit(self.args())
		self.assertEqual(set(report["missing"]), {"Report"})
		self.assertEqual(report["dynamic"][0]["value"], "doc.stock_uom")

	def test_generated_vendor_test_and_catalogue_sources_are_excluded(self):
		for directory in ("node_modules", "tests", "dist", "assets", "public/mfg"):
			path = self.app / directory / "ignored.py"
			path.parent.mkdir(parents=True, exist_ok=True)
			path.write_text('_("Ignored")', encoding="utf-8")
		self.assertEqual(coverage.audit(self.args())["missing"], {})

	def test_syntax_errors_are_reported_instead_of_skipped(self):
		(self.app / "broken.py").write_text("def (", encoding="utf-8")
		self.assertEqual(len(coverage.audit(self.args())["errors"]), 1)

	@unittest.skipUnless(
		shutil.which("node") and os.environ.get("COVERAGE_NODE_MODULES"),
		"Existing Babel parser path required",
	)
	def test_jsx_ast_extracts_literals_and_flags_visible_unwrapped_text(self):
		(self.app / "page.jsx").write_text(
			'const a = __("Known"); const b = translate(`Missing`); const c = __(labels[key]); const context = __("Known", [], "action"); const x = <p title="Raw title">Raw text {__("Known")}</p>; // __("Ignored")\n',
			encoding="utf-8",
		)
		args = self.args()
		args.node_modules = os.environ["COVERAGE_NODE_MODULES"]
		report = coverage.audit(args)
		self.assertEqual(set(report["missing"]), {"Missing", "Known:action"})
		self.assertEqual(report["dynamic"][0]["value"], "labels[key]")
		self.assertEqual({row["value"] for row in report["unwrapped"]}, {"Raw title", "Raw text"})


if __name__ == "__main__":
	unittest.main()
