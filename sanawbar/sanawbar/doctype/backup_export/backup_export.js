frappe.ui.form.on("Backup export", {
	refresh(frm) {
		if (frm.is_new()) {
			frappe.set_route("backup-export");
			return;
		}
		frm.disable_save();
		frm.add_custom_button(__("Create Export"), () => {
			frappe.set_route("backup-export");
		});
		const download = frm.fields_dict.download_link.$wrapper;
		download.empty();
		if (frm.doc.status === "Ready") {
			$("<a>", {
				text: __("Download Export"),
				href: "/api/method/sanawbar.business_export.service.download?name=" + encodeURIComponent(frm.doc.name),
				class: "btn btn-primary",
			}).css({ "min-height": "44px", "min-width": "44px", "display": "inline-flex", "align-items": "center" }).appendTo(download);
		}
		frm.add_custom_button(__("Export History"), () => frappe.set_route("backup-export", "view", "list"));
	},
});
