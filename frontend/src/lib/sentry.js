import * as Sentry from "@sentry/browser";

const MAX_TAG_LENGTH = 200;
let initialized = false;

function cleanString(value, maxLength = MAX_TAG_LENGTH) {
	return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stripQuery(value) {
	if (typeof value !== "string" || !value) return value;
	try {
		const url = new URL(value, window.location.origin);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return value;
	}
}

function scrubEvent(event) {
	if (event.request) {
		if (event.request.url) event.request.url = stripQuery(event.request.url);
		delete event.request.query_string;
	}
	for (const breadcrumb of event.breadcrumbs || []) {
		for (const key of ["url", "from", "to"]) {
			if (breadcrumb?.data?.[key]) breadcrumb.data[key] = stripQuery(breadcrumb.data[key]);
		}
	}
	return event;
}

export function initSentry(config = window.sanawbar_config?.sentry) {
	if (initialized || !config || typeof config !== "object") return false;

	const dsn = cleanString(config.dsn, 1000);
	if (!dsn) return false;

	const tags = {};
	const product = cleanString(config.product);
	const tenant = cleanString(config.tenant);
	if (product) tags.product = product;
	if (tenant) tags.tenant = tenant;

	try {
		Sentry.init({
			dsn,
			environment: cleanString(config.environment) || undefined,
			release: cleanString(config.release, 250) || undefined,
			sendDefaultPii: false,
			initialScope: {
				tags,
			},
			beforeSend: scrubEvent,
		});
		initialized = true;
		return true;
	} catch {
		return false;
	}
}

export async function captureSentryTestError(product) {
	if (!initialized) return null;

	const eventId = Sentry.captureException(
		new Error(`Intentional ${cleanString(product) || "application"} Sentry verification error`),
		{
			tags: {
				diagnostic: "manual-sentry-test",
			},
		}
	);
	return (await Sentry.flush(5000)) ? eventId : null;
}
