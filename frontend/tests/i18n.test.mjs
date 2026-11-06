import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const arabic = JSON.parse(await readFile(new URL("../../sanawbar/translations/ar.json", import.meta.url), "utf8"));
globalThis.window = { sanawbar_config: { lang: "ar", translations: arabic } };
const ar = await import("../src/lib/i18n.js?arabic");
globalThis.window = { sanawbar_config: { lang: "en", translations: {} } };
const en = await import("../src/lib/i18n.js?english");

test("Arabic and English keep direction and action wording", () => {
	assert.equal(ar.direction, "rtl");
	assert.equal(en.direction, "ltr");
	assert.equal(ar.__("Open {0}", ["WO-001"]), "فتح WO-001");
	assert.equal(en.__("Open {0}", ["WO-001"]), "Open WO-001");
	assert.equal(ar.__("Clear", undefined, "clear-control"), "مسح");
	assert.equal(ar.__("System", undefined, "colour-theme"), "حسب النظام");
	assert.equal(ar.__("System"), "النظام");
});

test("placeholder substitution preserves literal dollars, braces and repeated values", () => {
	assert.equal(en.__("{0} / {1} / {0}", ["$&{1}", "second"]), "$&{1} / second / $&{1}");
	assert.equal(ar.__("Open {0}", ["$&{1}"]), "فتح $&{1}");
	assert.equal(en.__("{0} {1}", [0]), "0 {1}");
	assert.equal(en.__("{0}", [null]), "");
});

test("context falls back to the generic key and then English", () => {
	assert.equal(ar.__("Cancel", undefined, "unknown-context"), "إلغاء");
	assert.equal(ar.__("Unknown source", undefined, "unknown-context"), "Unknown source");
});
