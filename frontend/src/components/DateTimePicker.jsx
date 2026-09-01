import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cx } from "./ui";
import {
	addDays,
	addMinutes,
	addMonths,
	clamp,
	displayValue,
	formatValue,
	isSameDay,
	monthGrid,
	monthLabel,
	outOfRange,
	parseValue,
	startOfDay,
	weekdayNames,
} from "../lib/datetime";
import { __, isRTL } from "../lib/i18n";

const PANEL_W = 300;
const PANEL_H = 400;

/**
 * Date / datetime field with a calendar popover.
 *
 * Replaces `<input type="date">` and `<input type="datetime-local">`, which are
 * poor here for three reasons: the whole control is not clickable (Chrome only
 * opens on the small calendar glyph), the rendering and first-day-of-week are
 * the browser's rather than the app's locale, and they are not themeable, so
 * they stayed stubbornly light in dark mode.
 *
 * The trigger is one full-width button, so a click anywhere on the field opens
 * the picker. Typing still works: the popover's text field takes focus on open.
 *
 * `size` is about density, not decoration. The default 44px trigger is a
 * shop-floor touch target, sized for a gloved finger on a tablet. A desk filter
 * bar is the opposite context: it sits in a row of 36px controls, and a taller
 * field there stands proud of its neighbours. Hence "compact", which lines the
 * trigger up with `inputCls`.
 *
 * Values are exchanged in Frappe's wire format ("YYYY-MM-DD HH:mm:ss", or
 * "YYYY-MM-DD" in date mode) and displayed in the user's locale.
 */
export default function DateTimePicker({
	value,
	onChange,
	mode = "datetime",
	size = "touch",
	min,
	max,
	placeholder,
	disabled,
	allowClear = true,
	id,
	className,
	"aria-describedby": describedBy,
}) {
	const withTime = mode !== "date";
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [cursor, setCursor] = useState(() => parseValue(value) || new Date());
	const [focusDay, setFocusDay] = useState(() => startOfDay(parseValue(value) || new Date()));

	const boxRef = useRef(null);
	const panelRef = useRef(null);
	const textRef = useRef(null);
	const gridId = useId();

	const selected = useMemo(() => parseValue(value), [value]);
	const minDate = useMemo(() => parseValue(min), [min]);
	const maxDate = useMemo(() => parseValue(max), [max]);
	const weekdays = useMemo(() => weekdayNames(), []);
	const days = useMemo(() => monthGrid(cursor), [cursor]);

	/* ------------------------------------------------------------ placement */

	// Portalled to document.body so the modal's `overflow-y-auto` cannot clip it,
	// which means the position has to be measured rather than inherited.
	const [pos, setPos] = useState(null);

	const place = useCallback(() => {
		const el = boxRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const gap = 4;
		const height = withTime ? PANEL_H : PANEL_H - 64;
		const below = window.innerHeight - r.bottom;
		const dropUp = below < height + gap && r.top > below;

		const width = Math.min(Math.max(r.width, PANEL_W), window.innerWidth - gap * 2);
		const logicalLeft = isRTL ? r.right - width : r.left;
		const top = dropUp ? Math.max(gap, r.top - height - gap) : r.bottom + gap;

		setPos({
			top,
			left: Math.max(gap, Math.min(logicalLeft, window.innerWidth - width - gap)),
			width,
			maxHeight: Math.max(120, window.innerHeight - top - gap),
		});
	}, [withTime]);

	useLayoutEffect(() => {
		if (!open) return undefined;
		place();
		window.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			window.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [open, place]);

	/* --------------------------------------------------------------- opening */

	function openPicker() {
		if (disabled) return;
		const base = selected || clamp(new Date(), minDate, maxDate);
		setCursor(base);
		setFocusDay(startOfDay(base));
		setDraft(selected ? displayValue(selected, mode) : "");
		setOpen(true);
	}

	useEffect(() => {
		if (!open) return undefined;
		// Focus the text field, so a keyboard user can type straight away and a
		// screen reader announces the picker rather than leaving focus behind.
		const id = setTimeout(() => textRef.current?.select(), 0);
		return () => clearTimeout(id);
	}, [open]);

	useEffect(() => {
		if (!open) return undefined;
		function onDown(e) {
			if (panelRef.current?.contains(e.target) || boxRef.current?.contains(e.target)) return;
			setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	/* --------------------------------------------------------------- commit */

	const commit = useCallback(
		(date, { close = false } = {}) => {
			if (!date) {
				onChange("");
				return;
			}
			const next = clamp(date, minDate, maxDate);
			onChange(formatValue(next, mode));
			setCursor(next);
			setFocusDay(startOfDay(next));
			setDraft(displayValue(next, mode));
			if (close) setOpen(false);
		},
		[onChange, mode, minDate, maxDate]
	);

	/** Picking a day keeps the time already chosen, so it is not silently reset. */
	function pickDay(day) {
		if (outOfRange(day, minDate, maxDate)) return;
		const base = selected || new Date();
		const next = new Date(
			day.getFullYear(),
			day.getMonth(),
			day.getDate(),
			withTime ? base.getHours() : 0,
			withTime ? base.getMinutes() : 0,
			0
		);
		commit(next, { close: !withTime });
	}

	function setTimePart(part, raw) {
		const base = selected || startOfDay(new Date());
		const n = Number(raw);
		if (Number.isNaN(n)) return;
		const next = new Date(base);
		if (part === "h") next.setHours(Math.max(0, Math.min(23, n)));
		else next.setMinutes(Math.max(0, Math.min(59, n)));
		next.setSeconds(0);
		commit(next);
	}

	/* ------------------------------------------------------------- keyboard */

	function onPanelKeyDown(e) {
		const typing = e.target === textRef.current;
		if (e.key === "Escape") {
			e.stopPropagation(); // don't also close the surrounding modal
			setOpen(false);
			boxRef.current?.focus();
			return;
		}
		if (typing && e.key === "Enter") {
			e.preventDefault();
			const parsed = parseValue(draft) || parseDisplay(draft);
			if (parsed) commit(parsed, { close: true });
			return;
		}
		if (typing) return;

		const step = { ArrowLeft: isRTL ? 1 : -1, ArrowRight: isRTL ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
		if (step) {
			e.preventDefault();
			const next = addDays(focusDay, step);
			setFocusDay(next);
			setCursor(next);
			return;
		}
		if (e.key === "PageUp" || e.key === "PageDown") {
			e.preventDefault();
			const next = addMonths(focusDay, e.key === "PageUp" ? -1 : 1);
			setFocusDay(next);
			setCursor(next);
			return;
		}
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			pickDay(focusDay);
		}
	}

	/* --------------------------------------------------------------- render */

	const presets = withTime
		? [
				{ label: __("Now"), get: () => new Date() },
				{ label: __("15 min ago"), get: () => addMinutes(new Date(), -15) },
				{ label: __("1 hour ago"), get: () => addMinutes(new Date(), -60) },
			]
		: [
				{ label: __("Today"), get: () => new Date() },
				{ label: __("Yesterday"), get: () => addDays(new Date(), -1) },
			];

	const shown = selected ? displayValue(selected, mode) : "";

	return (
		<>
			<div ref={boxRef} className={cx("relative", className)}>
				{/* One button covering the whole field: clicking anywhere opens it. */}
				<button
					id={id}
					type="button"
					disabled={disabled}
					onClick={openPicker}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-describedby={describedBy}
					className={cx(
						"flex w-full items-center gap-2 rounded-lg border text-start text-sm transition-colors",
						size === "compact" ? "h-9 px-2.5 py-1.5 max-lg:h-11" : "min-h-[44px] px-3 py-2",
						"focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60",
						open ? "border-accent ring-2 ring-ring/30" : "border-border-strong",
						"bg-surface hover:bg-surface-2"
					)}
				>
					<CalendarDays size={15} className="shrink-0 text-content-faint" />
					<span className={cx("grow truncate", !shown && "text-content-faint")}>
						{shown || placeholder || (withTime ? __("Select date and time") : __("Select a date"))}
					</span>
					{allowClear && shown && !disabled && (
						<span
							role="button"
							tabIndex={-1}
							aria-label={__("Clear")}
							onClick={(e) => {
								e.stopPropagation();
								onChange("");
							}}
							className="shrink-0 rounded p-0.5 text-content-faint hover:bg-surface-3 hover:text-content"
						>
							<X size={14} />
						</span>
					)}
				</button>
			</div>

			{open &&
				pos &&
				createPortal(
					<div
						ref={panelRef}
						role="dialog"
						aria-modal="false"
						aria-label={withTime ? __("Select date and time") : __("Select a date")}
						dir={document.documentElement.dir || "ltr"}
						onKeyDown={onPanelKeyDown}
						style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
						className="fixed z-[10050] overflow-y-auto animate-scale-in rounded-xl border border-border bg-surface p-3 shadow-lg"
					>
						<input
							ref={textRef}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder={withTime ? "2026-08-10 14:30" : "2026-08-10"}
							aria-label={__("Type a date")}
							className="mb-2 w-full rounded-lg border border-border-strong bg-surface-2 px-2.5 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-ring/30"
						/>

						<div className="mb-2 flex flex-wrap gap-1">
							{presets.map((p) => (
								<button
									key={p.label}
									type="button"
									onClick={() => commit(p.get(), { close: !withTime })}
									className="rounded-md bg-surface-3 px-2 py-1 text-2xs font-medium text-content-muted hover:bg-accent-soft hover:text-accent-soft-fg"
								>
									{p.label}
								</button>
							))}
						</div>

						<div className="mb-1 flex items-center justify-between">
							<NavButton
								label={__("Previous month")}
								icon={isRTL ? ChevronRight : ChevronLeft}
								onClick={() => setCursor(addMonths(cursor, -1))}
							/>
							<span aria-live="polite" className="text-sm font-semibold">
								{monthLabel(cursor)}
							</span>
							<NavButton
								label={__("Next month")}
								icon={isRTL ? ChevronLeft : ChevronRight}
								onClick={() => setCursor(addMonths(cursor, 1))}
							/>
						</div>

						<div className="grid grid-cols-7 gap-0.5" role="grid" aria-labelledby={gridId}>
							{weekdays.map((d) => (
								<div
									key={d}
									role="columnheader"
									className="pb-1 text-center text-2xs font-medium text-content-faint"
								>
									{d}
								</div>
							))}

							{days.map((day) => {
								const otherMonth = day.getMonth() !== cursor.getMonth();
								const disabledDay = outOfRange(day, minDate, maxDate);
								const isSelected = isSameDay(day, selected);
								const isToday = isSameDay(day, new Date());
								const isFocus = isSameDay(day, focusDay);

								return (
									<button
										key={day.toISOString()}
										type="button"
										role="gridcell"
										tabIndex={isFocus ? 0 : -1}
										disabled={disabledDay}
										aria-selected={isSelected}
										aria-current={isToday ? "date" : undefined}
										onClick={() => pickDay(day)}
										onFocus={() => setFocusDay(day)}
										className={cx(
											"relative h-9 rounded-md text-sm tabular-nums transition-colors",
											"focus:outline-none focus:ring-2 focus:ring-ring/40",
											"disabled:cursor-not-allowed disabled:opacity-30",
											isSelected
												? "bg-accent font-semibold text-accent-fg"
												: otherMonth
													? "text-content-faint hover:bg-surface-2"
													: "text-content hover:bg-surface-3"
										)}
									>
										{day.getDate()}
										{/* Today marker survives being selected, where a colour alone would not. */}
										{isToday && !isSelected && (
											<span className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-accent" />
										)}
									</button>
								);
							})}
						</div>

						{withTime && (
							<div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
								<Clock size={14} className="shrink-0 text-content-faint" />
								<TimeInput
									label={__("Hour")}
									value={selected ? selected.getHours() : 0}
									max={23}
									onChange={(v) => setTimePart("h", v)}
								/>
								<span className="text-content-faint">:</span>
								<TimeInput
									label={__("Minute")}
									value={selected ? selected.getMinutes() : 0}
									max={59}
									onChange={(v) => setTimePart("m", v)}
								/>
								<button
									type="button"
									onClick={() => setOpen(false)}
									className="ms-auto min-h-[36px] rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"
								>
									{__("Done")}
								</button>
							</div>
						)}
					</div>,
					document.body
				)}
		</>
	);
}

function NavButton({ label, icon: Icon, onClick }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="flex h-8 w-8 items-center justify-center rounded-lg text-content-muted hover:bg-surface-3 hover:text-content"
		>
			<Icon size={16} />
		</button>
	);
}

function TimeInput({ label, value, max, onChange }) {
	return (
		<input
			type="number"
			min={0}
			max={max}
			aria-label={label}
			value={String(value).padStart(2, "0")}
			onChange={(e) => onChange(e.target.value)}
			className="w-14 rounded-lg border border-border-strong bg-surface-2 px-2 py-1.5 text-center text-sm tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-ring/30"
		/>
	);
}

/**
 * Last-resort parse of whatever the user typed, for locales whose medium format
 * is not ISO-like. Only used when the strict wire-format parse has already failed.
 */
function parseDisplay(text) {
	if (!text?.trim()) return null;
	const parsed = new Date(text);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}
