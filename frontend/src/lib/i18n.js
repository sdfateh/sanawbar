// Translation + direction, driven by the logged-in user's language.
//
// Each consuming app's page controller resolves the language (user setting ->
// site default -> "en") and ships the merged message map in the page, so
// translations are available on the first render with no flash of English.

export function getAppConfig() {
	return window.sanawbar_config || {};
}

const config = getAppConfig();
const messages = config.translations || {};

export const lang = String(config.lang || "en").replace(/_/g, "-").toLowerCase();
export const baseLang = lang.split("-")[0];
export const direction = config.direction || (baseLang === "ar" ? "rtl" : "ltr");
export const isRTL = direction === "rtl";

/**
 * Translate a string, mirroring Frappe's `__()`.
 * Falls back to the source text, so untranslated strings still read correctly.
 *
 * Supports positional {0} substitution: __("Open {0}", [name])
 */
export function __(text, args) {
	let out = messages[text] || text;

	if (args && args.length) {
		args.forEach((val, i) => {
			out = out.replace(new RegExp(`\\{${i}\\}`, "g"), val ?? "");
		});
	}

	return out;
}

/**
 * Locale for Intl formatting. Arabic numerals stay Western (latn) because
 * ERPNext stores and displays costs that way; only the layout flips.
 */
export const locale = baseLang === "en" ? undefined : `${lang}-u-nu-latn`;
