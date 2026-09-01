// Date helpers for the shared picker.
//
// Everything here works in *local* time and never touches UTC. Frappe stores
// naive local datetimes ("2026-08-10 14:30:00"), so converting through UTC
// would shift every value by the site's offset.

import { baseLang, locale } from "./i18n";

const pad = (n) => String(n).padStart(2, "0");

/** Frappe's canonical wire formats. */
export function formatValue(date, mode = "datetime") {
	if (!date) return "";
	const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	if (mode === "date") return d;
	return `${d} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Parse the formats this app actually sees: Frappe's "YYYY-MM-DD HH:mm:ss",
 * a bare "YYYY-MM-DD", and the "YYYY-MM-DDTHH:mm" a native input emits.
 * Deliberately not `new Date(string)`, which treats a date-only string as UTC.
 */
export function parseValue(value) {
	if (!value) return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

	const m = String(value)
		.trim()
		.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
	if (!m) return null;

	const date = new Date(
		Number(m[1]),
		Number(m[2]) - 1,
		Number(m[3]),
		Number(m[4] || 0),
		Number(m[5] || 0),
		Number(m[6] || 0)
	);
	return Number.isNaN(date.getTime()) ? null : date;
}

/* ------------------------------------------------------------------ display */

const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
const monthFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });

/** What the closed field shows. Localised, unlike the wire format. */
export function displayValue(date, mode = "datetime") {
	if (!date) return "";
	return (mode === "date" ? dateFmt : dateTimeFmt).format(date);
}

export const monthLabel = (date) => monthFmt.format(date);

/**
 * Which weekday a calendar row starts on. `Intl.Locale` knows this per locale;
 * it reports 1=Monday..7=Sunday, while `Date.getDay()` is 0=Sunday..6=Saturday.
 */
export function firstDayOfWeek() {
	try {
		const loc = new Intl.Locale(locale || "en");
		const info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
		if (info?.firstDay) return info.firstDay % 7;
	} catch {
		/* older engines: fall through to the sensible regional default */
	}
	return baseLang === "ar" ? 6 : 1;
}

/** Localised short weekday names, already rotated to the locale's first day. */
export function weekdayNames() {
	const start = firstDayOfWeek();
	// 2024-01-07 is a Sunday, so adding the weekday index lands on that weekday.
	return Array.from({ length: 7 }, (_, i) =>
		weekdayFmt.format(new Date(2024, 0, 7 + ((start + i) % 7)))
	);
}

/* ------------------------------------------------------------------ maths */

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d, n) => {
	const out = new Date(d);
	out.setDate(out.getDate() + n);
	return out;
};

export const addMinutes = (d, n) => {
	const out = new Date(d);
	out.setMinutes(out.getMinutes() + n);
	return out;
};

/** Month arithmetic that does not roll over: 31 Jan + 1 month is 28/29 Feb. */
export function addMonths(d, n) {
	const out = new Date(d);
	const day = out.getDate();
	out.setDate(1);
	out.setMonth(out.getMonth() + n);
	out.setDate(Math.min(day, daysInMonth(out)));
	return out;
}

export const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export const isSameDay = (a, b) =>
	!!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The 42 cells of a 6-row month grid, including the leading/trailing spill. */
export function monthGrid(cursor) {
	const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
	const offset = (first.getDay() - firstDayOfWeek() + 7) % 7;
	const start = addDays(first, -offset);
	return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function clamp(date, min, max) {
	if (!date) return date;
	if (min && date < min) return new Date(min);
	if (max && date > max) return new Date(max);
	return date;
}

export const outOfRange = (date, min, max) =>
	(!!min && date < startOfDay(min)) || (!!max && date > max);
