const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
(async () => {
	const delegated = [];
	const router = { convert_to_standard_route(route) {
		assert.equal(this, router);
		delegated.push(route);
		return Promise.resolve(["original", ...route]);
	} };
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/backup_export_route.js"), "utf8"), { frappe: { router } });
	assert.deepEqual(await router.convert_to_standard_route(["backup-export"]), ["backup-export"]);
	for (const route of [["backup-export", "record-id"], ["backup-export", "view", "list"], ["sales-invoice"]]) {
		assert.deepEqual(await router.convert_to_standard_route(route), ["original", ...route]);
	}
	assert.equal(delegated.length, 3);
	console.log("Page URL, record URL, history URL and unrelated routes passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
