// Keep URL credentials, queries and fragments out of browser diagnostics,
// including URLs embedded in messages and nested SDK context.
function stripUrlSecrets(value) {
	return value.split(/[?#]/, 1)[0].replace(/((?:https?:)?\/\/)[^/@\s]+@/gi, "$1");
}

function scrubText(value) {
	return value.replace(/(?:https?:\/\/|\/\/|\/)[^\s<>"'`()[\]{}]+/gi, stripUrlSecrets);
}

export function scrubEvent(event) {
	if (event.request) {
		if (typeof event.request.url === "string") {
			event.request.url = stripUrlSecrets(event.request.url);
		}
		delete event.request.query_string;
	}
	for (const breadcrumb of event.breadcrumbs || []) {
		for (const key of ["url", "from", "to"]) {
			if (typeof breadcrumb?.data?.[key] === "string") {
				breadcrumb.data[key] = stripUrlSecrets(breadcrumb.data[key]);
			}
		}
	}

	const seen = new WeakSet();
	function scrub(value) {
		if (typeof value === "string") return scrubText(value);
		if (!value || typeof value !== "object" || seen.has(value)) return value;
		seen.add(value);
		for (const key of Object.keys(value)) value[key] = scrub(value[key]);
		return value;
	}
	return scrub(event);
}
