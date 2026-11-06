// Isolated production-build navigation checks for both shared-shell consumers.
// NODE_PATH must contain Playwright and @axe-core/playwright. Build directories
// are mandatory so this runner never serves canonical/live assets.
const http = require("http"),
	fs = require("fs"),
	path = require("path"),
	assert = require("assert/strict");
const { chromium } = require("playwright");
const { default: AxeBuilder } = require("@axe-core/playwright");
const family = path.resolve(__dirname, "../../..");
const output = process.env.NAV_QA_OUTPUT || "/tmp/navigation-validation/results";
fs.mkdirSync(output, { recursive: true });
const port = Number(process.env.NAV_QA_PORT || 4194);
const base = `http://127.0.0.1:${port}`;
const builds = {
	mfg: process.env.NAV_QA_MFG_BUILD,
	cheques: process.env.NAV_QA_CHEQUES_BUILD,
};
for (const directory of Object.values(builds))
	assert.ok(directory && directory.startsWith("/tmp/"), "Supply isolated /tmp builds");
const roots = {
	mfg: path.join(family, "mfg_suite/mfg_suite"),
	cheques: path.join(family, "cheque_management/cheque_management"),
};
const languages = {};
for (const app of Object.keys(builds))
	languages[app] = {
		...JSON.parse(fs.readFileSync(path.join(family, "sanawbar/sanawbar/translations/ar.json"))),
		...JSON.parse(fs.readFileSync(path.join(roots[app], "translations/ar.json"))),
	};
const server = http.createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	let filename;
	if (url.pathname.startsWith("/assets/mfg_suite/mfg/"))
		filename = path.join(builds.mfg, url.pathname.slice("/assets/mfg_suite/mfg/".length));
	else if (url.pathname.startsWith("/assets/cheque_management/frontend/"))
		filename = path.join(builds.cheques, url.pathname.slice("/assets/cheque_management/frontend/".length));
	else if (url.pathname.startsWith("/assets/sanawbar/"))
		filename = path.join(family, "sanawbar/sanawbar/public", url.pathname.slice("/assets/sanawbar/".length));
	if (filename) {
		if (!fs.existsSync(filename)) {
			res.writeHead(404);
			return res.end();
		}
		res.setHeader(
			"Content-Type",
			filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : "font/woff2"
		);
		return fs.createReadStream(filename).pipe(res);
	}
	const app = url.pathname.startsWith("/cheques") ? "cheques" : "mfg";
	const lang = url.searchParams.get("lang") || "en";
	const operator = url.searchParams.get("role") === "operator";
	const config = {
		lang,
		direction: lang === "ar" ? "rtl" : "ltr",
		translations: lang === "ar" ? languages[app] : {},
		user: {
			name: "qa@example.test",
			full_name: lang === "ar" ? "مراجع تجربة التنقل" : "Navigation Reviewer",
		},
		can_estimate: !operator,
		can_produce: true,
		can_supervise: !operator,
		can_trace: !operator,
		can_engineer: !operator,
		can_maintain: !operator,
		sentry: { enabled: false },
		realtime: { enabled: false },
	};
	res.setHeader("Content-Type", "text/html");
	res.end(
		fs
			.readFileSync(path.join(builds[app], "index.html"), "utf8")
			.replace("{{ mfg_config }}", JSON.stringify(config))
			.replace("{{ app_config }}", JSON.stringify(config))
	);
});
const routes = [
	["Home", "/mfg"],
	["Cost Estimator", "/mfg/estimator"],
	["Estimations", "/mfg/estimations"],
	["Production", "/mfg/production"],
	["Planning", "/mfg/planning"],
	["Manufacturing intelligence", "/mfg/intelligence"],
	["Schedule", "/mfg/schedule"],
	["Traceability", "/mfg/traceability"],
	["Engineering revisions", "/mfg/engineering"],
	["Machine maintenance", "/mfg/maintenance"],
];
(async () => {
	await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
	const browser = await chromium.launch({
		headless: true,
		args: ["--no-sandbox"],
	});
	const results =
		(process.env.NAV_QA_APP || process.env.NAV_QA_ACTIVE_ONLY) && fs.existsSync(`${output}/results.json`)
			? JSON.parse(fs.readFileSync(`${output}/results.json`)).filter(
					(row) => row.app !== process.env.NAV_QA_APP || row.scenario
				)
			: [];
	try {
		for (const app of process.env.NAV_QA_ACTIVE_ONLY
			? []
			: process.env.NAV_QA_APP
				? [process.env.NAV_QA_APP]
				: ["mfg", "cheques"])
			for (const lang of ["en", "ar"])
				for (const width of [320, 390, 768, 1280, 1440]) {
					const context = await browser.newContext({
						viewport: { width, height: 900 },
						hasTouch: true,
					});
					const page = await context.newPage();
					const errors = [];
					page.on("pageerror", (error) => errors.push(error.message));
					await page.route("**/api/method/**", (route) =>
						route.fulfill({
							json: {
								message: {
									alerts: [],
									profitability: [],
									summary: { orders_reviewed: 0 },
									checks: [],
									counts: {},
									kpis: {},
									buckets: [],
									currency: "JOD",
									precision: 2,
									rows: [],
									data: [],
									total: 0,
									currencies: [],
								},
							},
						})
					);
					const T = (key) => (lang === "ar" ? languages[app][key] || key : key);
					await page.goto(`${base}/${app}?lang=${lang}`);
					await page.getByRole("banner").waitFor();
					await page.waitForTimeout(200);
					const header = page.getByRole("banner");
					const geometry = await header.evaluate((el) => ({
						width: el.scrollWidth,
						client: el.clientWidth,
						scrolling: [...el.querySelectorAll("*")].filter(
							(x) => getComputedStyle(x).overflowX === "auto" || getComputedStyle(x).overflowX === "scroll"
						).length,
						small: [...el.querySelectorAll("a,button")]
							.filter((x) => x.getClientRects().length)
							.map((x) => ({
								text: x.textContent,
								width: x.getBoundingClientRect().width,
								height: x.getBoundingClientRect().height,
							}))
							.filter((x) => x.width < 44 || x.height < 44),
					}));
					assert.equal(geometry.width, geometry.client);
					assert.equal(geometry.scrolling, 0);
					assert.deepEqual(geometry.small, []);
					const compact = app === "mfg" ? width < 1280 : width < 768;
					if (compact) {
						const trigger = header.getByRole("button", {
							name: new RegExp(T("Pages")),
						});
						await trigger.click();
						const panel = page.getByRole("dialog", {
							name: T("Pages"),
							exact: true,
						});
						await panel.waitFor();
						const panelId = await panel.getAttribute("id");
						const waitForOpeningFocus = () => page.waitForFunction((id) => {
							const element = document.getElementById(id);
							const initial = element?.querySelector('[aria-current="page"]') || element?.querySelector("a") || element?.querySelector("button");
							return initial && document.activeElement === initial;
						}, panelId);
						await waitForOpeningFocus();
						const expected = app === "mfg" ? routes.map((x) => x[0]) : ["Dashboard", "All Cheques"];
						for (const label of expected) {
							assert.equal(await panel.getByRole("link", { name: T(label), exact: true }).count(), 1, label);
							if (app === "mfg") {
								const route = routes.find((x) => x[0] === label)[1];
								assert.equal(
									(
										await panel.getByRole("link", { name: T(label), exact: true }).getAttribute("href")
									).replace(/\/$/, ""),
									route
								);
							}
						}
						await page.screenshot({
							path: `${output}/${app}-${lang}-${width}-pages.png`,
							animations: "disabled",
						});
						const axe = await new AxeBuilder({ page })
							.include("header.sticky")
							.include('[role="dialog"]')
							.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
							.analyze();
						assert.deepEqual(
							axe.violations.map((v) => v.id),
							[]
						);
						await page.keyboard.press("Escape");
						await panel.waitFor({ state: "detached" });
						assert.ok(await trigger.evaluate((el) => el === document.activeElement));
						await trigger.click();
						// Opening focuses the current route on the next animation frame.
						// Wait for that contract before manually testing either boundary.
						await waitForOpeningFocus();
						await panel.getByRole("link").last().focus();
						await page.keyboard.press("Tab");
						await panel.waitFor({ state: "detached" });
						assert.ok(
							await header
								.getByRole("button", { name: T("Open user menu"), exact: true })
								.evaluate((el) => el === document.activeElement)
						);
						await trigger.click();
						await waitForOpeningFocus();
						await panel.getByRole("button", { name: T("Close navigation") }).focus();
						await page.keyboard.press("Shift+Tab");
						await panel.waitFor({ state: "detached" });
						assert.ok(await trigger.evaluate((el) => el === document.activeElement));
						await trigger.click();
						await header
							.getByText(T(app === "mfg" ? "MFG Suite" : "Cheques"), {
								exact: true,
							})
							.click();
						await panel.waitFor({ state: "detached" });
					} else {
						assert.equal(await header.getByRole("button", { name: new RegExp(T("Pages")) }).count(), 0);
						if (app === "mfg") {
							for (const label of ["Costing", "Production management", "Engineering and insights"]) {
								const trigger = header.getByRole("button", {
									name: new RegExp(T(label)),
								});
								await trigger.click();
								const panel = page.getByRole("dialog", {
									name: T(label),
									exact: true,
								});
								await panel.waitFor();
								await page.screenshot({
									path: `${output}/${app}-${lang}-${width}-${label.replaceAll(" ", "-")}-menu.png`,
									animations: "disabled",
								});
								await page.keyboard.press("Escape");
								await panel.waitFor({ state: "detached" });
								assert.ok(await trigger.evaluate((el) => el === document.activeElement));
							}
						} else
							assert.equal(
								await header.getByRole("link", { name: T("All Cheques"), exact: true }).count(),
								1
							);
						await page.screenshot({
							path: `${output}/${app}-${lang}-${width}-header.png`,
							animations: "disabled",
						});
					}
					await page.screenshot({
						path: `${output}/${app}-${lang}-${width}-closed.png`,
						animations: "disabled",
					});
					const axe = await new AxeBuilder({ page })
						.include("header.sticky")
						.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
						.analyze();
					assert.deepEqual(
						axe.violations.map((v) => v.id),
						[]
					);
					assert.deepEqual(errors, []);
					results.push({ app, lang, width, passed: true, geometry });
					fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
					await context.close();
				}
		if (!process.env.NAV_QA_APP)
			for (const lang of ["en", "ar"])
				for (const width of [390, 1280]) {
					const context = await browser.newContext({
						viewport: { width, height: 900 },
						hasTouch: true,
					});
					const page = await context.newPage();
					const errors = [];
					page.on("pageerror", (e) => errors.push(e.message));
					await page.route("**/api/method/**", (r) =>
						r.fulfill({
							json: {
								message: {
									alerts: [],
									profitability: [],
									summary: { orders_reviewed: 0 },
									checks: [],
									rows: [],
									data: [],
									total: 0,
								},
							},
						})
					);
					const T = (key) => (lang === "ar" ? languages.mfg[key] || key : key);
					await page.goto(`${base}/mfg?lang=${lang}`);
					const header = page.getByRole("banner");
					const trigger = header.getByRole("button", {
						name: new RegExp(T(width < 1280 ? "Pages" : "Engineering and insights")),
					});
					await trigger.click();
					await page
						.getByRole("dialog")
						.getByRole("link", {
							name: T("Engineering revisions"),
							exact: true,
						})
						.click();
					await page.waitForURL("**/mfg/engineering");
					assert.ok((await trigger.textContent()).includes(T("Engineering revisions")));
					assert.equal(await page.getByRole("dialog").count(), 0);
					await page.screenshot({
						path: `${output}/mfg-${lang}-${width}-current-page.png`,
						animations: "disabled",
					});
					const sizes = await header.evaluate((el) => ({
						width: el.scrollWidth,
						client: el.clientWidth,
					}));
					assert.equal(sizes.width, sizes.client);
					if (width === 390) {
						await page.goto(`${base}/mfg?lang=${lang}&role=operator`);
						await header.getByRole("button", { name: new RegExp(T("Pages")) }).click();
						const links = page.getByRole("dialog").getByRole("link");
						assert.equal(await links.count(), 3);
						assert.equal(await links.filter({ hasText: T("Engineering revisions") }).count(), 0);
					}
					assert.deepEqual(errors, []);
					results.push({
						app: "mfg",
						lang,
						width,
						scenario: "route selection and permission filtering",
						passed: true,
					});
					fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
					await context.close();
				}
		console.log(JSON.stringify(results, null, 2));
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}
})().catch((error) => {
	console.error(error);
	server.close();
	process.exit(1);
});
