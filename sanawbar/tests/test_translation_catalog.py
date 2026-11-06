"""Offline checks for the SPA/native translation catalogue contract."""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from sanawbar.translation_catalog import load_catalogue, native_csv, sync_catalogue


class TestTranslationCatalogue(unittest.TestCase):
	def setUp(self):
		self.directory = tempfile.TemporaryDirectory()
		self.addCleanup(self.directory.cleanup)
		self.path = Path(self.directory.name) / "ar.json"

	def write(self, catalogue):
		self.path.write_text(json.dumps(catalogue, ensure_ascii=False), encoding="utf-8")

	def test_preserves_arabic_context_commas_and_native_newlines(self):
		catalogue = {"Clear:clear-control": "مسح", "Hello, {0}\nAgain": "مرحبًا، {0}\nمجددًا"}
		rows = csv.reader(io.StringIO(native_csv(catalogue)))
		decoded = {source.replace("\\n", "\n"): value.replace("\\n", "\n") for source, value in rows}
		self.assertEqual(decoded, catalogue)

	def test_rejects_duplicate_keys(self):
		self.path.write_text('{"Cancel":"إلغاء","Cancel":"إلغاء آخر"}', encoding="utf-8")
		with self.assertRaisesRegex(ValueError, "Duplicate"):
			load_catalogue(self.path)

	def test_rejects_missing_or_altered_placeholders_and_empty_values(self):
		for catalogue in ({"Open {0}": "فتح"}, {"{0}": "{1}"}, {"Hello %s": "مرحبًا"}, {"Cancel": ""}):
			with self.subTest(catalogue=catalogue):
				self.write(catalogue)
				with self.assertRaises(ValueError):
					load_catalogue(self.path)

	def test_allows_reordered_placeholders(self):
		self.write({"{0} then {1}": "{1} بعد {0}"})
		self.assertEqual(len(load_catalogue(self.path)), 1)

	def test_check_detects_stale_csv_after_json_edits(self):
		self.write({"Cancel": "إلغاء"})
		with self.assertRaisesRegex(ValueError, "missing or stale"):
			sync_catalogue(self.path)
		self.assertEqual(sync_catalogue(self.path, write=True), 1)
		self.assertEqual(sync_catalogue(self.path), 1)
		self.write({"Cancel": "إلغاء", "Open": "فتح"})
		with self.assertRaisesRegex(ValueError, "missing or stale"):
			sync_catalogue(self.path)

	def test_rejects_whitespace_fragments_trimmed_by_native_frappe(self):
		for catalogue in ({" and more": "والمزيد"}, {"More": " المزيد"}):
			self.write(catalogue)
			with self.assertRaisesRegex(ValueError, "surrounding whitespace"):
				load_catalogue(self.path)
