frappe.listview_settings["Backup export"] = {
	onload(listview) {
		listview.page.set_primary_action(__("Create Export"), () => {
			frappe.set_route("backup-export");
		});
	},
	get_indicator(doc) {
		const colors = { Queued: "orange", Running: "blue", Ready: "green", Failed: "red", Expired: "gray" };
		return [__(doc.status), colors[doc.status], "status,=," + doc.status];
	},
};
