import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { sanawbar_config: { lang: "ar", csrf_token: "test-csrf", translations: {} } };
const { call, uploadFile } = await import("../src/lib/api.js");

test("API requests carry the selected display language using Frappe's native parameter", async () => {
	let request;
	globalThis.fetch = async (path, options) => {
		request = { path, ...options };
		return { ok: true, status: 200, json: async () => ({ message: "تم الحفظ" }) };
	};
	assert.equal(await call("example.action", { name: "WO-1" }), "تم الحفظ");
	assert.deepEqual(JSON.parse(request.body), { name: "WO-1", _lang: "ar" });
	assert.equal(request.headers["X-Frappe-CSRF-Token"], "test-csrf");
	assert.equal(request.credentials, "same-origin");
});

test("file uploads use the same display language", async () => {
	let request;
	globalThis.fetch = async (_path, options) => {
		request = options;
		return { ok: true, status: 200, json: async () => ({ message: { name: "FILE-1" } }) };
	};
	assert.deepEqual(await uploadFile(new Blob(["test"]), "Work Order", "WO-1"), { name: "FILE-1" });
	assert.equal(request.body.get("_lang"), "ar");
	assert.equal(request.body.get("docname"), "WO-1");
});
