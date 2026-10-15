// Reserve the bare route for the page, preserving Frappe's record/list routing.
(() => {
	const original = frappe.router.convert_to_standard_route;
	frappe.router.convert_to_standard_route = function (route) {
		if (route.length === 1 && route[0] === "backup-export") {
			return Promise.resolve(route);
		}
		return original.call(this, route);
	};
})();
