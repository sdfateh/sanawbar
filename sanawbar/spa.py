"""Shared, script-safe bootstrap helpers for Sanawbar React applications."""

import json
import os
from pathlib import Path

import frappe
import frappe.sessions
from frappe.utils import cint

RTL_LANGUAGES = ("ar", "he", "fa", "ps", "ur", "sy", "dv", "ku")


def script_safe_json(value):
	return (
		json.dumps(value, ensure_ascii=False, separators=(",", ":"))
		.replace("&", "\\u0026")
		.replace("<", "\\u003c")
		.replace(">", "\\u003e")
		.replace("\u2028", "\\u2028")
		.replace("\u2029", "\\u2029")
	)


def is_rtl(lang):
	return (lang or "").split("-")[0] in RTL_LANGUAGES


def get_user_lang():
	return (
		frappe.db.get_value("User", frappe.session.user, "language")
		or frappe.db.get_default("lang")
		or frappe.db.get_single_value("System Settings", "language")
		or "en"
	).replace("_", "-")


def get_translations(lang, app_names=("sanawbar",)):
	"""Merge JSON catalogues in order; later domain catalogues override shared UI."""
	base_lang = (lang or "").replace("_", "-").split("-")[0].lower()
	if not base_lang or base_lang == "en":
		return {}
	if not base_lang.isascii() or not base_lang.isalpha() or len(base_lang) not in (2, 3):
		return {}

	apps = tuple(dict.fromkeys(app_names or ("sanawbar",)))
	cache_key = f"{base_lang}:{','.join(apps)}"

	def _load():
		catalogue = {}
		for app_name in apps:
			path = Path(frappe.get_app_path(app_name, "translations", f"{base_lang}.json"))
			try:
				app_catalogue = json.loads(path.read_text(encoding="utf-8"))
			except FileNotFoundError:
				continue
			except (OSError, json.JSONDecodeError):
				frappe.log_error(
					title=f"{app_name}: invalid {base_lang} translation catalogue",
					message=frappe.get_traceback(),
				)
				continue
			if not isinstance(app_catalogue, dict) or any(
				not isinstance(source, str) or not isinstance(translated, str)
				for source, translated in app_catalogue.items()
			):
				frappe.log_error(
					title=f"{app_name}: invalid {base_lang} translation catalogue",
					message=f"{path} must contain one JSON object with string keys and values.",
				)
				continue
			catalogue.update(app_catalogue)
		return catalogue

	return frappe.cache.hget("sanawbar_translations_json", cache_key, generator=_load)


def language_config(translation_apps=("sanawbar",)):
	lang = get_user_lang()
	return {
		"lang": lang,
		"direction": "rtl" if is_rtl(lang) else "ltr",
		"translations": get_translations(lang, translation_apps),
	}


def user_config():
	user = frappe.db.get_value(
		"User",
		frappe.session.user,
		["name", "full_name", "email", "user_image"],
		as_dict=True,
	) or frappe._dict(name=frappe.session.user)
	return {
		"id": user.name,
		"full_name": user.full_name or user.name,
		"email": user.email or user.name,
		"image": user.user_image,
	}


def sentry_config(*, product, dsn_env, release_env):
	"""Return a browser-safe Sentry bootstrap when site telemetry is enabled."""
	if not frappe.get_system_settings("enable_telemetry"):
		return None

	dsn = os.getenv(dsn_env, "").strip()
	if not dsn:
		return None

	environment = os.getenv("SENTRY_ENVIRONMENT", "").strip() or (
		"development" if frappe.conf.developer_mode else "production"
	)
	release = os.getenv(release_env, "").strip() or frappe.utils.get_build_version()
	return {
		"dsn": dsn,
		"environment": environment,
		"release": release,
		"tenant": frappe.local.site,
		"product": product,
	}


def sentry_test_requested(route_prefix):
	"""Return whether the request targets the temporary product test route."""
	request = getattr(frappe.local, "request", None)
	path = getattr(request, "path", "")
	return path.rstrip("/") == "/" + route_prefix.strip("/") + "/sentry-test"


def require_sentry_test_access(route_prefix):
	"""Restrict temporary Sentry diagnostics to authenticated System Managers."""
	requested = sentry_test_requested(route_prefix)
	if requested and (
		frappe.session.user == "Guest" or "System Manager" not in frappe.get_roles()
	):
		frappe.throw(frappe._("You do not have permission to run this diagnostic."), frappe.PermissionError)
	return requested


def build_config(app_name, translation_apps, csrf_refresh_path, **flags):
	csrf_token = frappe.sessions.get_csrf_token()
	frappe.db.commit()  # nosemgrep - token must exist before the page renders
	config = {
		"csrf_token": csrf_token,
		"csrf_refresh_path": csrf_refresh_path,
		"app_name": app_name,
		"realtime": {
			"enabled": not bool(cint(frappe.conf.get("disable_async"))),
			"site_name": frappe.local.site,
		},
		"user": user_config(),
		**language_config(translation_apps),
	}
	config.update(flags)
	return config
