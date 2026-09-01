// Shared transport for Frappe SPAs. Domain clients provide their own dotted
// methods; this module owns only session, CSRF, upload, cache, and logout work.

import { __, getAppConfig } from "./i18n";

let csrfToken = getAppConfig().csrf_token || "";

export async function call(method, body, options = {}) {
	const { signal, retried = false } = options;
	const path = method === "logout" ? "/api/method/logout" : `/api/method/${method}`;
	const res = await fetch(path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Frappe-CSRF-Token": csrfToken,
		},
		credentials: "same-origin",
		body: JSON.stringify(body || {}),
		signal,
	});
	const data = await res.json().catch(() => ({}));

	if (res.status === 400 && data.exc_type === "CSRFTokenError" && !retried) {
		const fresh = await refreshCsrfToken();
		if (fresh) {
			csrfToken = fresh;
			return call(method, body, { ...options, retried: true });
		}
		throw new Error(__("Your session expired. Reload the page to continue."));
	}

	if (!res.ok) {
		let message = data.exception || data._error_message || res.statusText;
		try {
			const parsed = JSON.parse(data._server_messages || "[]");
			if (parsed.length) message = JSON.parse(parsed[0]).message || message;
		} catch {
			/* use the best message already available */
		}
		const error = new Error(message);
		error.status = res.status;
		error.type = data.exc_type;
		throw error;
	}

	return data.message;
}

async function refreshCsrfToken() {
	try {
		const shellPath = getAppConfig().csrf_refresh_path || window.location.pathname;
		const res = await fetch(shellPath, { credentials: "same-origin" });
		if (!res.ok) return null;
		const html = await res.text();
		const match = html.match(/"csrf_token"\s*:\s*"([^"]+)"/);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}

export async function uploadFile(file, doctype, docname) {
	const body = new FormData();
	body.append("file", file);
	body.append("doctype", doctype);
	body.append("docname", docname);
	body.append("is_private", "1");
	const res = await fetch("/api/method/upload_file", {
		method: "POST",
		headers: { "X-Frappe-CSRF-Token": csrfToken },
		credentials: "same-origin",
		body,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.exception || data._error_message || res.statusText);
	return data.message;
}

export async function clearCache() {
	try {
		Object.keys(window.localStorage || {})
			.filter((key) => key.startsWith("_") || key.includes("assets") || key.includes("frappe"))
			.forEach((key) => window.localStorage.removeItem(key));
	} catch {
		/* localStorage may be unavailable */
	}
	const message = await call("frappe.sessions.clear");
	window.__sanawbarSkipUnloadPrompt = true;
	window.location.reload();
	return message;
}

export async function logout() {
	await call("logout");
	window.__sanawbarSkipUnloadPrompt = true;
	const redirectTo = window.location.pathname + window.location.search + window.location.hash;
	window.location.assign(`/login?redirect-to=${encodeURIComponent(redirectTo)}`);
}
