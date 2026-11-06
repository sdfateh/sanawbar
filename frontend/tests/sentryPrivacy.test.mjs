import assert from "node:assert/strict";
import test from "node:test";
import { scrubEvent } from "../src/lib/sentryPrivacy.js";

const url = "https://user:password@example.test/api?token=private-token#private-fragment";
const clean = "https://example.test/api";

test("redacts URL secrets in request, exception, stack and breadcrumb payloads", () => {
	const event = {
		request: { url, query_string: "token=private-token" },
		exception: { values: [{ value: `Request failed (${url})`, stacktrace: { frames: [{ filename: url, lineno: 42 }] } }] },
		breadcrumbs: [{ message: `GET ${url} failed`, data: { url, from: "/mfg?token=private-token", to: "/cheques#private-fragment" } }],
		logentry: { formatted: `Failed at ${url}`, params: [url] },
		extra: { nested: [url, { url }] },
	};
	assert.equal(scrubEvent(event), event);
	assert.equal(event.request.url, clean);
	assert.equal("query_string" in event.request, false);
	assert.equal(event.exception.values[0].value, `Request failed (${clean})`);
	assert.deepEqual(event.exception.values[0].stacktrace.frames, [{ filename: clean, lineno: 42 }]);
	assert.equal(event.breadcrumbs[0].message, `GET ${clean} failed`);
	assert.deepEqual(event.breadcrumbs[0].data, { url: clean, from: "/mfg", to: "/cheques" });
	assert.equal(event.logentry.formatted, `Failed at ${clean}`);
	assert.deepEqual(event.logentry.params, [clean]);
	assert.deepEqual(event.extra.nested, [clean, { url: clean }]);
	for (const secret of ["private-token", "private-fragment", "password"]) {
		assert.equal(JSON.stringify(event).includes(secret), false);
	}
});

test("handles relative URLs, multiple URLs and fragment-only secrets in text", () => {
	const event = { message: "Fetch /api/method?token=one or https://example.test/two#two or //user:password@example.test/three?token=three" };
	scrubEvent(event);
	assert.equal(event.message, "Fetch /api/method or https://example.test/two or //example.test/three");
});

test("preserves useful non-URL diagnostics and handles cyclic context", () => {
	const event = { message: "Unexpected value: 42?", level: "error", tags: { product: "mfg", tenant: "example.test" }, extra: { answer: 42, absent: null, flags: [true, false] } };
	const before = structuredClone(event);
	assert.deepEqual(scrubEvent(event), before);
	event.extra.self = event;
	assert.equal(scrubEvent(event).extra.self, event);
});
