import frappe
from frappe import _
from frappe.model.document import Document

from sanawbar.business_export.service import _INTERNAL


class Backupexport(Document):
	def before_insert(self):
		self.require_internal()

	def validate(self):
		self.require_internal()

	def on_trash(self):
		self.require_internal()

	def require_internal(self):
		if not _INTERNAL.get():
			frappe.throw(
				_("Use Create Export to request an export. Export history cannot be edited."),
				frappe.PermissionError,
			)
