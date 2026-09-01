import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cx } from "./ui";
import { popoverStyle, usePopoverPosition } from "../lib/popover";
import { __ } from "../lib/i18n";

/**
 * Secondary line under an option: the code, plus any extra context the server
 * sent, minus the title we are already showing on the first line.
 */
function secondaryLine(opt) {
	if (!opt.label) return opt.description || "";

	const extra = (opt.description || "")
		.split(", ")
		.filter((part) => part && part !== opt.label)
		.join(", ");

	return extra ? `${opt.value} · ${extra}` : opt.value;
}

/**
 * Autocomplete bound to a Frappe doctype, the SPA equivalent of a desk Link field.
 *
 * Search is supplied by the owning domain so its server-side permission policy
 * remains authoritative.
 * `onSelect` receives the chosen value so callers can fetch dependent fields.
 */
export default function LinkField({
	doctype,
	value,
	onChange,
	onSelect,
	filters,
	placeholder,
	disabled,
	className = "",
	allowClear = true,
	// Human-readable title for the current `value` (e.g. the row's item_name).
	// Shown in the closed input while `value` stays the stored docname.
	valueLabel,
	// The consuming app supplies its own permission-aware search endpoint. This
	// keeps the shared field independent of every domain's DocType allowlist.
	search,
}) {
	if (typeof search !== "function") {
		throw new TypeError("LinkField requires a search adapter");
	}
	const [open, setOpen] = useState(false);
	const [txt, setTxt] = useState("");
	const [options, setOptions] = useState([]);
	const [active, setActive] = useState(0);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(null);

	const boxRef = useRef(null);
	const inputRef = useRef(null);
	const listRef = useRef(null);
	const optionRefs = useRef([]);
	const timer = useRef();
	const request = useRef(0);
	const controller = useRef(null);
	const listId = useId();

	// Placement lives in lib/popover so this and Select flip, clamp and follow the
	// page identically; see the note there on why a portal makes it necessary.
	const pos = usePopoverPosition(boxRef, open);

	// What the input shows: the typed query while open, the bound value otherwise.
	// While open, show what is being typed. When closed, prefer the readable
	// title over the raw code - `value` itself is unchanged either way.
	const shown = open ? txt : valueLabel || value || "";

	const filterKey = useMemo(() => JSON.stringify(filters || {}), [filters]);

	useEffect(() => {
		if (!open) return;

		clearTimeout(timer.current);
		controller.current?.abort();
		const generation = ++request.current;
		setLoading(true);
		timer.current = setTimeout(async () => {
			const abort = new AbortController();
			controller.current = abort;
			try {
				const res = await search(doctype, txt, filters, { signal: abort.signal });
				if (generation !== request.current) return;
				setOptions(res || []);
				setActive(0);
				setFailed(null);
			} catch (e) {
				if (e.name === "AbortError" || generation !== request.current) return;
				// Surface the reason instead of rendering an empty list - a silent
				// "no results" is indistinguishable from a broken session.
				setOptions([]);
				setFailed(e.message || __("Search failed"));
			} finally {
				if (generation === request.current) setLoading(false);
			}
		}, 200);

		return () => {
			clearTimeout(timer.current);
			controller.current?.abort();
		};
	}, [txt, open, doctype, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
	}, [active]);

	// Close when focus leaves the widget entirely. The list lives in a portal, so
	// it is not a DOM descendant of the field - check it separately.
	useEffect(() => {
		function onDocDown(e) {
			const inField = boxRef.current && boxRef.current.contains(e.target);
			const inList = listRef.current && listRef.current.contains(e.target);
			if (!inField && !inList) setOpen(false);
		}
		document.addEventListener("mousedown", onDocDown);
		return () => document.removeEventListener("mousedown", onDocDown);
	}, []);

	function choose(opt) {
		onChange(opt.value);
		onSelect?.(opt.value);
		setOpen(false);
		setTxt("");
	}

	function onKeyDown(e) {
		if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
			setOpen(true);
			setTxt("");
			return;
		}
		if (!open) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((i) => Math.min(i + 1, options.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (options[active]) choose(options[active]);
		} else if (e.key === "Escape") {
			setOpen(false);
			setTxt("");
		} else if (e.key === "Tab") {
			setOpen(false);
			setTxt("");
		}
	}

	return (
		<div ref={boxRef} className="relative">
			<div className="relative">
				<input
					ref={inputRef}
					// The chevron/clear affordance is absolutely positioned at
					// `end-1.5` and is ~23px wide, but the callers' padding is only
					// 8-10px, so in a narrow column the value ran underneath it.
					// Reserving the space here fixes every LinkField at once rather
					// than relying on each caller's class.
					className={cx(className, !disabled && "pe-7")}
					value={shown}
					disabled={disabled}
					placeholder={placeholder || __("Search…")}
					role="combobox"
					aria-expanded={open}
					aria-controls={listId}
					aria-activedescendant={open && options[active] ? `${listId}-option-${active}` : undefined}
					aria-autocomplete="list"
					onChange={(e) => {
						setTxt(e.target.value);
						if (!open) setOpen(true);
					}}
					onFocus={() => {
						if (!disabled) {
							setOpen(true);
							setTxt("");
						}
					}}
					onKeyDown={onKeyDown}
					onBlur={() => requestAnimationFrame(() => {
						const focused = document.activeElement;
						if (!boxRef.current?.contains(focused) && !listRef.current?.contains(focused)) {
							setOpen(false);
							setTxt("");
						}
					})}
				/>

				{!disabled && (
					<span className="pointer-events-none absolute inset-y-0 end-1.5 flex items-center text-content-faint">
						{value && allowClear ? (
							<button
								type="button"
								className="pointer-events-auto rounded p-0.5 hover:bg-surface-3 hover:text-content-muted"
							onClick={() => {
								onChange("");
								onSelect?.("");
								inputRef.current?.focus();
								}}
								aria-label={__("Clear")}
							>
								<X size={13} />
							</button>
						) : (
							<ChevronDown size={13} />
						)}
					</span>
				)}
			</div>

			{open && pos && createPortal(
				<ul
					ref={listRef}
					id={listId}
					role="listbox"
					dir={document.documentElement.dir || "ltr"}
					style={popoverStyle(pos)}
					className="animate-scale-in overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
				>
					{loading && options.length === 0 && (
						<li className="px-3 py-2 text-xs text-content-faint">{__("Searching…")}</li>
					)}

					{!loading && failed && (
						<li className="px-3 py-2 text-xs text-danger">{failed}</li>
					)}

					{!loading && !failed && options.length === 0 && (
						<li className="px-3 py-2 text-xs text-content-faint">
							{__("No matching {0}", [__(doctype)])}
						</li>
					)}

					{options.map((opt, i) => (
					<li key={opt.value} id={`${listId}-option-${i}`} ref={(el) => { optionRefs.current[i] = el; }} role="option" aria-selected={i === active}>
							<button
								type="button"
								className={`block w-full rounded-lg px-2.5 py-1.5 text-start text-sm transition-colors ${
									i === active ? "bg-accent-soft text-accent-soft-fg" : "hover:bg-surface-2"
								}`}
								onMouseEnter={() => setActive(i)}
							onClick={() => choose(opt)}
							>
								{/* Lead with the human-readable title (Item -> item_name) and
								    keep the code as the secondary line. */}
								<span className="block truncate">{opt.label || opt.value}</span>
								{secondaryLine(opt) && (
									<span className="block truncate text-xs text-content-faint">
										{secondaryLine(opt)}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>,
				document.body
			)}
		</div>
	);
}
