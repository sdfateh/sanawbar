import { Check, ChevronDown } from "lucide-react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cx } from "./ui";
import { __ } from "../lib/i18n";
import { popoverStyle, usePopoverPosition } from "../lib/popover";

/**
 * Dropdown for a fixed list of options - the themed counterpart to LinkField.
 *
 * Replaces `<select>`, which can only be styled on the outside: the option list
 * itself is drawn by the operating system, so it ignores the app's theme, its
 * fonts and its dark mode entirely, exactly as the native date input did. It
 * also cannot show a check against the current value, or translate its own
 * chevron's direction in RTL.
 *
 * Shares its placement, its popover chrome and its keyboard model with
 * LinkField, so a dropdown behaves the same wherever it appears.
 *
 * `options` is an array of strings, or of { value, label, disabled } objects. A
 * disabled option stays visible - the shop floor needs to see that a workstation
 * exists but is down - and is skipped by both the pointer and the keyboard.
 *
 * `variant` matches the surface it sits on, mirroring the field styles in
 * components/ui: "field" is the standalone control, "cell" its quieter twin for
 * table cells (a full border on every cell turns a grid into a wall of boxes),
 * and "bare" drops the border entirely for shells that draw their own.
 */
const VARIANTS = {
	field: {
		base: "h-9 rounded-lg border px-2.5 py-1.5",
		idle: "border-border-strong bg-surface hover:bg-surface-2",
		open: "border-accent ring-2 ring-accent/20",
	},
	cell: {
		base: "h-8 rounded-md border px-2 py-1",
		idle: "border-transparent bg-transparent hover:border-border-strong",
		open: "border-accent bg-surface ring-2 ring-accent/20",
	},
	bare: {
		base: "h-8 rounded-md border px-2.5 py-1",
		idle: "border-transparent bg-transparent hover:bg-surface-2",
		open: "border-accent bg-surface ring-2 ring-accent/20",
	},
};

const Select = forwardRef(function Select({
	value,
	onChange,
	options = [],
	placeholder,
	disabled,
	invalid,
	variant = "field",
	className,
	"aria-label": ariaLabel,
	"aria-required": ariaRequired,
	"aria-invalid": ariaInvalid,
}, ref) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const boxRef = useRef(null);
	const triggerRef = useRef(null);
	const listRef = useRef(null);

	// Callers focus this control the way they focus an input (an invalid field is
	// focused on submit), so the ref has to land on the trigger, not the wrapper.
	useImperativeHandle(ref, () => triggerRef.current, []);
	const optionRefs = useRef([]);
	const listId = useId();

	const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
	const all = placeholder != null ? [{ value: "", label: placeholder }, ...items] : items;

	// A stored value that is no longer offered still has to be visible: falling
	// back to the first option would silently misreport it as something else.
	const known = all.find((o) => o.value === (value ?? ""));
	const orphan = !known && value ? { value, label: value, orphan: true } : null;
	const current = known || orphan || all[0];
	const list = orphan ? [...all, orphan] : all;

	const pos = usePopoverPosition(boxRef, open);

	// Open on the current value, so the list starts where the eye expects it.
	useEffect(() => {
		if (open) setActive(Math.max(list.findIndex((o) => o.value === (value ?? "")), 0));
	}, [open]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!open) return;
		optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
	}, [active, open]);

	// A click anywhere else closes it. Pointerdown, not click, so the popover is
	// gone before the next control takes focus.
	useEffect(() => {
		if (!open) return;
		function onPointerDown(e) {
			if (boxRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
			setOpen(false);
		}
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	function choose(option) {
		if (option.disabled) return;
		onChange(option.value);
		setOpen(false);
		triggerRef.current?.focus();
	}

	// Arrow keys land only on options that can actually be chosen.
	function step(from, delta) {
		let i = from;
		for (let n = 0; n < list.length; n++) {
			i += delta;
			if (i < 0 || i > list.length - 1) return from;
			if (!list[i].disabled) return i;
		}
		return from;
	}

	function onKeyDown(e) {
		if (!open) {
			if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
				e.preventDefault();
				setOpen(true);
			}
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((i) => step(i, 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => step(i, -1));
		} else if (e.key === "Home") {
			e.preventDefault();
			setActive(list.findIndex((o) => !o.disabled));
		} else if (e.key === "End") {
			e.preventDefault();
			setActive(list.map((o) => !o.disabled).lastIndexOf(true));
		} else if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			if (list[active]) choose(list[active]);
		}
	}

	return (
		<div ref={boxRef} className={cx("relative", className)}>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				onKeyDown={onKeyDown}
				role="combobox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-label={ariaLabel}
				aria-required={ariaRequired}
				aria-invalid={ariaInvalid ?? (invalid || undefined)}
				className={cx(
					"flex w-full items-center gap-2 text-start text-sm transition-colors",
					"focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60",
					VARIANTS[variant].base,
					open ? VARIANTS[variant].open : VARIANTS[variant].idle,
					invalid && !open && "border-danger bg-danger-soft"
				)}
			>
				<span
					className={cx(
						"grow truncate",
						current?.value === "" && "text-content-faint"
					)}
				>
					{__(current?.label ?? "")}
				</span>
				<ChevronDown
					size={14}
					className={cx(
						"shrink-0 text-content-faint transition-transform",
						open && "rotate-180"
					)}
				/>
			</button>

			{open &&
				pos &&
				createPortal(
					<ul
						ref={listRef}
						id={listId}
						role="listbox"
						style={popoverStyle(pos)}
						className="animate-scale-in overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
					>
						{list.map((option, i) => {
							const selected = option.value === (value ?? "");
							return (
								<li
									key={option.value || "__any"}
									role="option"
									aria-selected={selected}
									ref={(el) => {
										optionRefs.current[i] = el;
									}}
								>
									<button
										type="button"
										disabled={option.disabled}
										onMouseEnter={() => !option.disabled && setActive(i)}
										onClick={() => choose(option)}
										className={cx(
											"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm transition-colors",
											option.disabled
												? "cursor-not-allowed text-content-faint"
												: i === active
													? "bg-accent-soft text-accent-soft-fg"
													: "hover:bg-surface-2",
											!option.disabled && option.value === "" && "text-content-muted"
										)}
									>
										<span className="grow truncate">{__(option.label)}</span>
										{selected && <Check size={14} className="shrink-0" />}
									</button>
								</li>
							);
						})}
					</ul>,
					document.body
				)}
		</div>
	);
});

export default Select;
