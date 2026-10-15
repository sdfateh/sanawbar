frappe.pages["backup-export"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Backup export"), single_column: true });
	const body = $("<div>").css({ padding: "24px", "max-width": "640px" }).appendTo(page.body);
	$("<p>").text(__("Download your business data. Your download will be available for 24 hours.")).appendTo(body);
	$("<p>", { class: "text-muted" }).text(__("One export every 24 hours, maximum two in seven days.")).appendTo(body);
	const status = $("<p>", { role: "status", "aria-live": "polite" }).appendTo(body);
	const download = $("<a>", { class: "btn btn-primary", text: __("Download Export") })
		.css({ "min-height": "44px", "min-width": "44px", "align-items": "center" }).hide().appendTo(body);
	let timer;
	let busy = false;
	let loading = false;
	let creating = false;
	const visible = () => frappe.get_route()[0] === "backup-export";
	const button = page.set_primary_action(__("Create Export"), async () => {
		if (busy || creating || loading) return;
		creating = true;
		button.prop("disabled", true);
		try {
			await frappe.call({ method: "sanawbar.business_export.service.create_export", type: "POST" });
			await refresh();
		} catch (error) {
			status.text(__("Could not create the export. Please try again."));
		} finally {
			creating = false;
			button.prop("disabled", busy);
		}
	});
	button.css({ "min-height": "44px", "min-width": "44px" });
	async function refresh() {
		clearTimeout(timer);
		if (!visible() || loading) return;
		loading = true;
		button.prop("disabled", true);
		try {
			const response = await frappe.call({ method: "sanawbar.business_export.service.latest_export", type: "GET" });
			if (!visible()) return;
			const result = response.message;
			busy = !!result && ["Queued", "Running"].includes(result.status);
			download.hide().removeAttr("href");
			if (!result) status.text(__("Create an export when you are ready."));
			else if (busy) status.text(__("Preparing your export. This page updates automatically."));
			else if (result.status === "Ready") {
				status.text(__("Your export is ready."));
				download.attr("href", "/api/method/sanawbar.business_export.service.download?name=" + encodeURIComponent(result.name))
					.css("display", "inline-flex");
			} else if (result.status === "Expired") status.text(__("This export has expired. Create a new one."));
			else status.text(__("Export failed. Please try again."));
			timer = setTimeout(refresh, busy ? 3000 : 30000);
		} catch (error) {
			download.hide().removeAttr("href");
			status.text(__("Could not load the export status. Please refresh the page."));
		} finally {
			loading = false;
			button.prop("disabled", busy || creating);
		}
	}
	wrapper.refresh_export = refresh;
};
frappe.pages["backup-export"].on_page_show = function (wrapper) {
	wrapper.refresh_export();
};
