// Node-only behavior checks for the native Desk page; no browser dependencies.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

async function run() {
	const nodes = [];
	const timers = [];
	const calls = [];
	let primary;
	let reply = null;
	let route = "backup-export";
	function $(tag, attrs = {}) {
		const node = { tag, attrs: { ...attrs }, styles: {}, props: {}, visible: true,
			css(values) { Object.assign(this.styles, typeof values === "string" ? { [values]: arguments[1] } : values); this.visible = this.styles.display !== "none"; return this; },
			appendTo() { return this; }, text(value) { this.value = value; return this; },
			hide() { this.visible = false; return this; },
			attr(key, value) { this.attrs[key] = value; return this; },
			removeAttr(key) { delete this.attrs[key]; return this; },
			prop(key, value) { this.props[key] = value; return this; }
		};
		nodes.push(node);
		return node;
	}
	const button = $("button");
	const frappe = {
		pages: { "backup-export": {} }, get_route: () => [route],
		ui: { make_app_page: () => ({ body: {}, set_primary_action(label, click) { primary = click; return button; } }) },
		async call(args) { calls.push(args); return { message: reply }; }
	};
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../sanawbar/page/backup_export/backup_export.js"), "utf8"), {
		frappe, $, __: (text) => text, setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {}
	});
	const wrapper = {};
	frappe.pages["backup-export"].on_page_load(wrapper);
	const link = nodes.find(node => node.tag === "<a>");
	const status = nodes.find(node => node.attrs.role === "status");
	await wrapper.refresh_export();
	assert.match(status.value, /Create an export/);
	assert.equal(button.props.disabled, false);
	assert.equal(link.visible, false);
	reply = { name: "safe-id", status: "Running" };
	await wrapper.refresh_export();
	assert.equal(button.props.disabled, true);
	assert.equal(timers.at(-1).delay, 3000);
	assert.equal(status.attrs["aria-live"], "polite");
	reply = { name: "safe-id", status: "Ready" };
	await wrapper.refresh_export();
	assert.equal(link.visible, true);
	assert.match(link.attrs.href, /service.download\?name=safe-id$/);
	assert.equal(button.props.disabled, false);
	reply = { name: "safe-id", status: "Expired" };
	await wrapper.refresh_export();
	assert.equal(link.visible, false);
	assert.equal(link.attrs.href, undefined);
	assert.match(status.value, /expired/);

	reply = { name: "safe-id", status: "Queued" };
	await Promise.all([primary(), primary()]);
	assert.equal(calls.filter(call => call.method.endsWith("create_export")).length, 1);
	assert.equal(button.props.disabled, true);
	route = "another-page";
	const count = calls.length;
	await wrapper.refresh_export();
	assert.equal(calls.length, count);
	console.log("Export page checks passed: idle, running, ready, expired, polling, duplicate click, navigation.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
