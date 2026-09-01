# Copyright (c) 2026, Salah and contributors

import json
import unittest
from unittest.mock import patch

import frappe

from sanawbar.spa import get_translations, is_rtl, script_safe_json, user_config


class TestSharedPageBootstrap(unittest.TestCase):
	def test_profile_bootstrap_contains_safe_current_user_data(self):
		user = frappe._dict(
			name="operator@example.com",
			full_name="Operator One",
			email="operator@example.com",
			user_image="/files/operator.png",
		)
		with patch.object(frappe.db, "get_value", return_value=user):
			result = user_config()

		self.assertEqual(
			result,
			{
				"id": "operator@example.com",
				"full_name": "Operator One",
				"email": "operator@example.com",
				"image": "/files/operator.png",
			},
		)

	def test_script_safe_json_cannot_close_script_element(self):
		value = {
			"csrf_token": '"</script><script>alert(1)</script>&',
			"translations": {"unsafe": "\u2028\u2029</ScRiPt>"},
		}

		encoded = script_safe_json(value)

		self.assertNotIn("<", encoded)
		self.assertNotIn(">", encoded)
		self.assertNotIn("&", encoded)
		self.assertNotIn("\u2028", encoded)
		self.assertNotIn("\u2029", encoded)
		self.assertEqual(json.loads(encoded), value)

	def test_regional_rtl_language(self):
		self.assertTrue(is_rtl("ar-SA"))
		self.assertFalse(is_rtl("en-US"))

	def test_translation_catalogue_supports_regional_codes_and_rejects_paths(self):
		self.assertEqual(get_translations("ar-JO"), get_translations("ar"))
		self.assertEqual(get_translations("../ar"), {})
