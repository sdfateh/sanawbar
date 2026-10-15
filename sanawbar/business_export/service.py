"""Authenticated, site-local export lifecycle. All tracking writes use Document APIs."""

import hashlib
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from pathlib import Path

import frappe
from frappe import _
from frappe.utils import get_datetime, get_system_timezone

from sanawbar.business_export.engine import ExportError, sha256_file, write_package
from sanawbar.business_export.snapshot import snapshot_reader

DOCTYPE = "Backup export"
ROLE = "Business Data Exporter"
_INTERNAL = ContextVar("business_export_internal", default=False)
ACTIVE = ("Queued", "Running")


def utcnow():
	return datetime.now(timezone.utc).replace(tzinfo=None)


@contextmanager
def internal_write():
	token = _INTERNAL.set(True)
	try:
		yield
	finally:
		_INTERNAL.reset(token)


def deny(message=None):
	frappe.throw(message or _("You are not authorized to export this business data."), frappe.PermissionError)


def authorized_scope(user=None):
	user = user or frappe.session.user
	frappe.local.role_permissions = {}
	if not user or user == "Guest" or not frappe.db.get_value("User", user, "enabled"):
		deny(_("Sign in with an enabled user account to export business data."))
	# Read membership freshly: worker/download must observe role revocation.
	roles = frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role")
	if ROLE not in roles:
		deny(_("Your account must be explicitly assigned the Business Data Exporter role."))
	# The export role grants site-wide business export access independently of
	# Company/User Permissions and source document read permissions.
	companies = sorted(frappe.get_all("Company", pluck="name"))
	if not companies:
		deny(_("There are no companies in this site to export."))
	return companies


def scope_key(scope):
	return hashlib.sha256(json.dumps(sorted(scope), ensure_ascii=False).encode()).hexdigest()


def scope_lock(key, blocking_timeout=5):
	# RedisWrapper namespaces keys with the active site. Never accept a site from the caller.
	return frappe.cache.lock(
		frappe.cache.make_key("business-export:" + key), timeout=3600, blocking_timeout=blocking_timeout
	)


def assert_access(doc, user=None, download=False):
	user = user or frappe.session.user
	scope = authorized_scope(user)
	if not set(json.loads(doc.company_scope)) <= set(scope):
		deny()
	if download and (doc.status != "Ready" or not doc.expires_at or get_datetime(doc.expires_at) <= utcnow()):
		deny()
	return scope


def has_permission(doc, user=None, permission_type=None, ptype=None, **kwargs):
	if (permission_type or ptype or "read") not in ("read", "select"):
		return False
	# Framework probes must return a boolean without leaving an error popup in
	# the response when probing an unsaved form or an inaccessible record.
	previous_mute = frappe.flags.mute_messages
	frappe.flags.mute_messages = True
	try:
		if doc.is_new():
			# Requester and scope are assigned exclusively by create_export().
			authorized_scope(user)
		else:
			assert_access(doc, user)
		return True
	except (frappe.PermissionError, ValueError, TypeError):
		return False
	finally:
		frappe.flags.mute_messages = previous_mute


def permission_query(user=None):
	user = user or frappe.session.user
	try:
		authorized_scope(user)
	except frappe.PermissionError:
		return "1=0"
	return "1=1"


def save(doc):
	with internal_write():
		doc.save(ignore_permissions=True)


def next_export_time(request_times, now):
	"""Rolling site-wide quota; exact 24-hour and seven-day boundaries are allowed."""
	recent = sorted((get_datetime(value) for value in request_times), reverse=True)
	allowed = now
	if recent:
		allowed = max(allowed, recent[0] + timedelta(days=1))
	if len(recent) >= 2:
		allowed = max(allowed, recent[1] + timedelta(days=7))
	return allowed


def enforce_export_quota(now):
	# Count accepted requests in every status, regardless of requester or company set.
	recent = frappe.get_all(
		DOCTYPE,
		filters={"requested_at": [">", now - timedelta(days=7)]},
		pluck="requested_at",
		order_by="requested_at desc",
		limit=2,
	)
	if next_export_time(recent, now) > now:
		frappe.throw(
			_(
				"Export limit reached. Only allow one export every 24 hours and at most two exports in seven days."
			)
		)


@frappe.whitelist(methods=["POST"])
def create_export():
	scope = authorized_scope()
	if not frappe.db.table_exists("Company"):
		frappe.throw(_("ERPNext business tables are required for this export."))
	key = scope_key(scope)
	with scope_lock("site-request-quota"), scope_lock(key):
		# Start a fresh read after waiting for the lock, so concurrent requests see
		# the preceding committed reservation even under REPEATABLE READ.
		frappe.db.rollback()
		requested_at = utcnow()
		enforce_export_quota(requested_at)
		active = frappe.get_all(
			DOCTYPE, filters={"scope_key": key, "status": ["in", ACTIVE]}, pluck="name", limit=1
		)
		if active:
			frappe.throw(_("An export for this company scope is already queued or running."))
		with internal_write():
			doc = frappe.get_doc(
				{
					"doctype": DOCTYPE,
					"requester": frappe.session.user,
					"company_scope": json.dumps(scope, ensure_ascii=False),
					"scope_key": key,
					"requested_at": requested_at,
					"status": "Queued",
				}
			).insert(ignore_permissions=True)
		# Persist under the scope lock before queueing. A queue outage is recorded below;
		# a process death in this gap is recovered by cleanup's stale-job handling.
		frappe.db.commit()
		try:
			frappe.enqueue(
				"sanawbar.business_export.service.generate",
				name=doc.name,
				queue="long",
				timeout=3300,
				job_id="business-export-" + doc.name,
				deduplicate=True,
			)
		except Exception:  # noqa: BLE001 - persist failure without exposing a partial artifact
			mark_failed(doc)
			frappe.db.commit()
			frappe.throw(_("The export could not be queued. Please try again."))
	return doc.name


def storage():
	path = Path(frappe.get_site_path("private", "business_exports")).resolve()
	path.mkdir(mode=0o700, parents=True, exist_ok=True)
	return path


def artifact_path(doc):
	# Hash autoname and this basename check prevent path traversal even for tampered records.
	if (
		not doc.name
		or len(doc.name) != 10
		or any(c not in "0123456789abcdefghijklmnopqrstuv" for c in doc.name)
	):
		raise ExportError("Invalid export identifier")
	return storage() / (doc.name + ".zip")


def mark_failed(doc):
	artifact_path(doc).unlink(missing_ok=True)
	doc.status = "Failed"
	doc.private_export_file = None
	doc.error_message = _(
		"Export failed. No file is available. Ask an administrator to review the server log."
	)
	save(doc)


def generate(name):
	doc = frappe.get_doc(DOCTYPE, name)
	with scope_lock(doc.scope_key):
		doc.reload()
		if doc.status != "Queued":
			return
		try:
			assert_access(doc, doc.requester)
			doc.status = "Running"
			save(doc)
			frappe.db.commit()
			with snapshot_reader() as (reader, snapshot):
				rows = reader.collect(json.loads(doc.company_scope))
				missing = reader.missing
			with tempfile.TemporaryDirectory(prefix=doc.name + "-", dir=storage()) as directory:
				package, manifest = write_package(
					directory, rows, snapshot, json.loads(doc.company_scope), missing, get_system_timezone()
				)
				# Re-read role and company access after potentially lengthy generation.
				frappe.db.rollback()
				assert_access(doc, doc.requester)
				os.chmod(package, 0o600)
				doc.checksum = sha256_file(package)
				os.replace(package, artifact_path(doc))
				doc.snapshot_time = get_datetime(snapshot.rstrip("Z"))
				doc.expires_at = utcnow() + timedelta(hours=24)
				doc.status = "Ready"
				doc.private_export_file = artifact_path(doc).name
				doc.record_counts = json.dumps(manifest["counts"], sort_keys=True)
				doc.permission_index = None
				save(doc)
				frappe.db.commit()
		except Exception:  # noqa: BLE001 - persist failure without exposing a partial artifact
			frappe.db.rollback()
			doc.reload()
			mark_failed(doc)
			frappe.db.commit()
			frappe.log_error(title="Business data export failed")


@frappe.whitelist(methods=["GET"])
def download(name):
	doc = frappe.get_doc(DOCTYPE, name)
	assert_access(doc, download=True)
	path = artifact_path(doc)
	if not path.is_file() or doc.private_export_file != path.name:
		deny()
	content = path.read_bytes()
	if hashlib.sha256(content).hexdigest() != doc.checksum:
		deny()
	# Large download reads may cross expiry or a role revocation.
	frappe.db.rollback()
	doc.reload()
	assert_access(doc, download=True)
	frappe.local.response.filename = "business-data.zip"
	frappe.local.response.filecontent = content
	frappe.local.response.type = "download"
	frappe.local.response.display_content_as = "attachment"
	from frappe.utils.response import build_response

	response = build_response("download")
	response.headers["Cache-Control"] = "no-store, private"
	response.headers["X-Content-Type-Options"] = "nosniff"
	return response


def cleanup():
	"""Five-minute cleanup; download expiry is enforced immediately, even if scheduler is down."""
	for name in frappe.get_all(DOCTYPE, filters={"status": ["in", ["Ready", *ACTIVE]]}, pluck="name"):
		doc = frappe.get_doc(DOCTYPE, name)
		try:
			with scope_lock(doc.scope_key, blocking_timeout=0):
				doc.reload()
				if doc.status == "Ready" and get_datetime(doc.expires_at) <= utcnow():
					artifact_path(doc).unlink(missing_ok=True)
					doc.status = "Expired"
					doc.private_export_file = None
					doc.permission_index = None
					save(doc)
				elif doc.status in ACTIVE and get_datetime(doc.requested_at) < utcnow() - timedelta(hours=2):
					mark_failed(doc)
				frappe.db.commit()
		except Exception as exc:
			from redis.exceptions import LockError

			if not isinstance(exc, LockError):
				raise
	# Recover orphan ZIPs/staging directories after killed workers. Never touch active paths.
	for path in storage().iterdir():
		if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).replace(
			tzinfo=None
		) > utcnow() - timedelta(hours=2):
			continue
		name = path.name.split("-", 1)[0].removesuffix(".zip")
		if any(c not in "0123456789abcdefghijklmnopqrstuv" for c in name):
			continue
		doc = frappe.get_doc(DOCTYPE, name) if frappe.db.exists(DOCTYPE, name) else None
		if doc and doc.status in (*ACTIVE, "Ready"):
			continue
		if path.is_dir():
			shutil.rmtree(path)
		else:
			path.unlink(missing_ok=True)


def install():
	if not frappe.db.exists("Role", ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(
			ignore_permissions=True
		)


@frappe.whitelist(methods=["GET"])
def latest_export():
	"""Small page response; no source records, requester details, or private paths."""
	scope = authorized_scope()
	filters = {"scope_key": scope_key(scope)}
	active = frappe.get_all(DOCTYPE, filters={**filters, "status": ["in", ACTIVE]}, pluck="name", limit=1)
	names = active or frappe.get_all(
		DOCTYPE, filters=filters, pluck="name", order_by="creation desc", limit=1
	)
	if not names:
		return None
	doc = frappe.get_doc(DOCTYPE, names[0])
	assert_access(doc)
	status = doc.status
	if status == "Ready" and (not doc.expires_at or get_datetime(doc.expires_at) <= utcnow()):
		status = "Expired"
	return {"name": doc.name, "status": status}
