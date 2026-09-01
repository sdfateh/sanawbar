import { Loader2 } from "lucide-react";
import { cloneElement, forwardRef, isValidElement } from "react";

import { __ } from "../../lib/i18n";

export const cx = (...parts) => parts.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ Button */

const BUTTON_VARIANTS = {
	primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-xs",
	secondary: "bg-surface text-content border border-border-strong hover:bg-surface-2",
	ghost: "text-content-muted hover:bg-surface-3 hover:text-content",
	// text-danger-fg, not text-white: the dark theme's danger fill is light, and
	// white on it measures 3.35:1.
	danger: "bg-danger text-danger-fg hover:opacity-90 shadow-xs",
	soft: "bg-accent-soft text-accent-soft-fg hover:brightness-95 dark:hover:brightness-125",
};

const BUTTON_SIZES = {
	sm: "h-8 px-2.5 text-xs gap-1.5 rounded-md max-lg:h-11",
	md: "h-9 px-3.5 text-sm gap-2 rounded-lg max-lg:h-11",
	lg: "h-11 px-5 text-sm gap-2 rounded-lg",
	icon: "h-9 w-9 justify-center rounded-lg max-lg:h-11 max-lg:w-11",
};

export const Button = forwardRef(function Button(
	{
		as: Tag = "button",
		variant = "secondary",
		size = "md",
		icon: Icon,
		iconEnd: IconEnd,
		busy,
		block,
		className,
		children,
		...props
	},
	ref
) {
	return (
		<Tag
			ref={ref}
			className={cx(
				"inline-flex items-center font-medium transition-colors",
				"disabled:pointer-events-none disabled:opacity-50",
				BUTTON_VARIANTS[variant],
				BUTTON_SIZES[size],
				block && "w-full justify-center",
				className
			)}
			disabled={Tag === "button" ? busy || props.disabled : undefined}
			{...props}
		>
			{busy ? (
				<Loader2 size={15} className="animate-spin" />
			) : (
				Icon && <Icon size={15} className="shrink-0" />
			)}
			{children}
			{IconEnd && !busy && <IconEnd size={15} className="shrink-0" />}
		</Tag>
	);
});

/* ------------------------------------------------------------------- Badge */

const BADGE_TONES = {
	neutral: "bg-surface-3 text-content-muted",
	accent: "bg-accent-soft text-accent-soft-fg",
	success: "bg-success-soft text-success-soft-fg",
	warning: "bg-warning-soft text-warning-soft-fg",
	danger: "bg-danger-soft text-danger-soft-fg",
};

export function Badge({ tone = "neutral", className, children, ...props }) {
	return (
		<span
			className={cx(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium",
				BADGE_TONES[tone],
				className
			)}
			{...props}
		>
			{children}
		</span>
	);
}

/* -------------------------------------------------------------------- Card */

export function Card({ title, description, action, padded = true, className, children }) {
	return (
		<section
			className={cx(
				"overflow-hidden rounded-xl border border-border bg-surface shadow-xs",
				className
			)}
		>
			{(title || action) && (
				<header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
					<div className="min-w-0">
						{title && <h2 className="truncate text-sm font-semibold">{title}</h2>}
						{description && (
							<p className="mt-0.5 text-xs text-content-muted">{description}</p>
						)}
					</div>
					{action && <div className="shrink-0">{action}</div>}
				</header>
			)}
			<div className={padded ? "p-4" : undefined}>{children}</div>
		</section>
	);
}

/* ------------------------------------------------------------------ States */

export function EmptyState({ icon: Icon, title, description, action }) {
	// Empty states are intentionally dense. Normalize shared Button actions here
	// so every consumer gets the same compact desktop treatment while Button's
	// responsive `sm` size still provides a 44px target on tablet layouts.
	const compactAction =
		isValidElement(action) && action.type === Button
			? cloneElement(action, { size: "sm" })
			: action;

	return (
		<div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-6 text-center">
			{Icon && (
				<span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 text-content-faint">
					<Icon size={18} />
				</span>
			)}
			<p className="text-sm text-content-faint">{title}</p>
			{description && (
				<p className="max-w-sm text-xs leading-relaxed text-content-muted">{description}</p>
			)}
			{compactAction && <div>{compactAction}</div>}
		</div>
	);
}

export function Skeleton({ className }) {
	return <div className={cx("animate-pulse rounded-md bg-surface-3", className)} />;
}

export function Spinner({ size = 20, className }) {
	return <Loader2 size={size} className={cx("animate-spin text-content-faint", className)} />;
}

const ALERT_TONES = {
	danger: "border-danger/30 bg-danger-soft text-danger-soft-fg",
	warning: "border-warning/30 bg-warning-soft text-warning-soft-fg",
	success: "border-success/30 bg-success-soft text-success-soft-fg",
	accent: "border-accent/30 bg-accent-soft text-accent-soft-fg",
};

export function Alert({ tone = "danger", icon: Icon, children, action }) {
	return (
		<div
			role={tone === "danger" ? "alert" : "status"}
			data-tone={tone}
			className={cx(
				"flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
				ALERT_TONES[tone]
			)}
		>
			{Icon && <Icon size={15} className="mt-0.5 shrink-0" />}
			<div className="min-w-0 grow">{children}</div>
			{action}
		</div>
	);
}

/* ------------------------------------------------------------- Page header */

export function PageHeader({ title, description, children }) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-3">
			<div className="min-w-0">
				<h1 className="text-lg font-semibold tracking-tight">{title}</h1>
				{description && (
					<p className="mt-1 text-sm text-content-muted">{description}</p>
				)}
			</div>
			{children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
		</div>
	);
}

// Shared field surfaces, used by every screen in both SPA pages. `inputCls` is
// the standalone form control; `cellCls` is its quieter twin for table cells,
// where a full border on every cell would turn the grid into a wall of boxes.
// h-9 is explicit so an <input>, a <select> and a LinkField line up: a select
// sizes to the font's own line box rather than the CSS line-height, so without a
// fixed height it stands taller than the fields beside it. LinkField carries no
// styling of its own - it applies only the caller's className - so anything
// rendering one MUST pass this, or it falls back to a bare browser input.
export const inputCls =
	"h-9 w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-content max-lg:h-11 " +
	"outline-none transition-colors placeholder:text-content-faint " +
	"focus:border-accent focus:ring-2 focus:ring-accent/20 " +
	"disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-content-muted";

export const cellCls =
	"h-8 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-content max-lg:h-11 " +
	"outline-none transition-colors placeholder:text-content-faint " +
	"hover:border-border-strong focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20 " +
	"disabled:text-content-muted disabled:hover:border-transparent";

/**
 * A single headline figure. Deliberately NOT a chart: one number's job is to be
 * read, and a plot around it would add ink without adding information.
 *
 * `tone` colours the figure only for a state that means something (overdue,
 * bounced). It always ships with its label, and with an icon where a tone is
 * set, so the state is never carried by colour alone.
 */
export function StatTile({ label, value, sub, tone = "neutral", icon: Icon, active, onClick }) {
	const toneClass = {
		neutral: "text-content",
		danger: "text-danger",
		warning: "text-warning",
		success: "text-success",
	}[tone];

	const Element = onClick ? "button" : "div";

	return (
		<Element
			type={onClick ? "button" : undefined}
			onClick={onClick}
			className={cx(
				"rounded-xl border bg-surface p-3 text-start transition-colors",
				onClick && "hover:border-border-strong",
				active ? "border-accent ring-1 ring-accent" : "border-border"
			)}
		>
			<div className="flex items-center gap-1.5 text-xs text-content-muted">
				{Icon && <Icon size={13} className={tone === "neutral" ? undefined : toneClass} />}
				<span className="truncate">{label}</span>
			</div>
			<div className={cx("mt-1 text-xl font-semibold tabular-nums tracking-tight", toneClass)}>
				{value}
			</div>
			{sub != null && <div className="mt-0.5 text-xs text-content-faint">{sub}</div>}
		</Element>
	);
}

export { __ };
