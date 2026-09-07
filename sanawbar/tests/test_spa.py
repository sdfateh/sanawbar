# Copyright (c) 2026, Salah and contributors

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import frappe

from sanawbar.spa import (
	get_translations,
	is_rtl,
	require_sentry_test_access,
	script_safe_json,
	sentry_config,
	sentry_test_requested,
	user_config,
)


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

	@patch.dict("os.environ", {"MFG_SENTRY_DSN": "https://public@example.com/1"}, clear=True)
	@patch("sanawbar.spa.frappe.get_system_settings", return_value=False)
	def test_sentry_config_requires_site_telemetry_opt_in(self, _get_system_settings):
		self.assertIsNone(
			sentry_config(product="mfg", dsn_env="MFG_SENTRY_DSN", release_env="MFG_SENTRY_RELEASE")
		)

	@patch.dict("os.environ", {}, clear=True)
	@patch("sanawbar.spa.frappe.get_system_settings", return_value=True)
	def test_sentry_config_requires_product_dsn(self, _get_system_settings):
		self.assertIsNone(
			sentry_config(product="cheques", dsn_env="CHEQUES_SENTRY_DSN", release_env="CHEQUES_SENTRY_RELEASE")
		)

	@patch.dict(
		"os.environ",
		{
			"CATALOG_SENTRY_DSN": " https://public@example.com/3 ",
			"CATALOG_SENTRY_RELEASE": " catalog@abc123 ",
			"SENTRY_ENVIRONMENT": " staging ",
		},
		clear=True,
	)
	@patch("sanawbar.spa.frappe.get_system_settings", return_value=True)
	@patch("sanawbar.spa.frappe.local", SimpleNamespace(site="tenant.example.com"))
	def test_sentry_config_contains_only_browser_safe_context(self, _get_system_settings):
		self.assertEqual(
			sentry_config(
				product="catalog",
				dsn_env="CATALOG_SENTRY_DSN",
				release_env="CATALOG_SENTRY_RELEASE",
			),
			{
				"dsn": "https://public@example.com/3",
				"environment": "staging",
				"release": "catalog@abc123",
				"tenant": "tenant.example.com",
				"product": "catalog",
			},
		)

	@patch.dict("os.environ", {"MFG_SENTRY_DSN": "https://public@example.com/1"}, clear=True)
	@patch("sanawbar.spa.frappe.get_system_settings", return_value=True)
	@patch("sanawbar.spa.frappe.utils.get_build_version", return_value="build-123")
	@patch("sanawbar.spa.frappe.local", SimpleNamespace(site="tenant.example.com"))
	@patch("sanawbar.spa.frappe.conf", SimpleNamespace(developer_mode=1))
	def test_sentry_config_uses_safe_environment_and_release_defaults(
		self,
		_get_build_version,
		_get_system_settings,
	):
		config = sentry_config(
			product="mfg",
			dsn_env="MFG_SENTRY_DSN",
			release_env="MFG_SENTRY_RELEASE",
		)
		self.assertEqual(config["environment"], "development")
		self.assertEqual(config["release"], "build-123")

	@patch(
		"sanawbar.spa.frappe.local",
		SimpleNamespace(request=SimpleNamespace(path="/mfg/sentry-test/")),
	)
	def test_sentry_test_route_matches_only_exact_product_path(self):
		self.assertTrue(sentry_test_requested("mfg"))
		self.assertFalse(sentry_test_requested("cheques"))

	@patch("sanawbar.spa.frappe.get_roles", return_value=["System Manager"])
	@patch("sanawbar.spa.frappe.session", SimpleNamespace(user="Administrator"))
	@patch(
		"sanawbar.spa.frappe.local",
		SimpleNamespace(request=SimpleNamespace(path="/catalog/sentry-test")),
	)
	def test_sentry_test_route_allows_system_manager(self, _get_roles):
		self.assertTrue(require_sentry_test_access("catalog"))

	@patch("sanawbar.spa.frappe.get_roles", return_value=["Accounts User"])
	@patch("sanawbar.spa.frappe.session", SimpleNamespace(user="accounts@example.com"))
	@patch(
		"sanawbar.spa.frappe.local",
		SimpleNamespace(request=SimpleNamespace(path="/cheques/sentry-test")),
	)
	def test_sentry_test_route_rejects_non_system_manager(self, _get_roles):
		with (
			patch("sanawbar.spa.frappe._", side_effect=lambda value: value),
			patch("sanawbar.spa.frappe.throw", side_effect=frappe.PermissionError),
			self.assertRaises(frappe.PermissionError),
		):
			require_sentry_test_access("cheques")
