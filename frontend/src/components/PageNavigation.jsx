import { Check, ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useResolvedPath } from "react-router-dom";

import { __ } from "../lib/i18n";
import { popoverStyle, usePopoverPosition } from "../lib/popover";
import { cx } from "./ui";

const linkClass =
	"flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-3 py-2 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent";

function PageLink({ link, active, onSelect, panel = false }) {
	const Icon = link.icon;
	const className = cx(
		linkClass,
		panel && "w-full",
		active
			? "bg-accent-soft font-medium text-accent-soft-fg"
			: "text-content-muted hover:bg-surface-2 hover:text-content"
	);
	const content = (
		<>
			{Icon && <Icon size={17} className="shrink-0" aria-hidden="true" />}
			<span className="min-w-0 break-words">{__(link.label)}</span>
			{active && panel && <Check size={16} className="ms-auto shrink-0" aria-hidden="true" />}
		</>
	);
	return link.href ? (
		<a href={link.href} className={className} onClick={onSelect}>
			{content}
		</a>
	) : (
		<NavLink to={link.to} end={link.end} className={className} onClick={onSelect}>
			{content}
		</NavLink>
	);
}

function PageDisclosure({ label, current, groups, activeLink, allPages = false }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef(null);
	const panelRef = useRef(null);
	const focused = useRef(false);
	const panelId = useId();
	const titleId = useId();
	const pos = usePopoverPosition(triggerRef, open, {
		minWidth: allPages ? 360 : 300,
		maxHeight: 640,
	});
	const location = useLocation();

	function close(restoreFocus = true) {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}

	useEffect(() => setOpen(false), [location.pathname, location.search]);
	useEffect(() => {
		if (!open) {
			focused.current = false;
			return undefined;
		}
		if (!pos || focused.current) return undefined;
		const frame = requestAnimationFrame(() => {
			focused.current = true;
			const selected = panelRef.current?.querySelector('[aria-current="page"]');
			(
				selected ||
				panelRef.current?.querySelector("a") ||
				panelRef.current?.querySelector("button")
			)?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [open, pos]);
	useEffect(() => {
		if (!open) return undefined;
		function outside(event) {
			if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target))
				close(false);
		}
		function keydown(event) {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
			}
			if (event.key !== "Tab" || !panelRef.current?.contains(document.activeElement)) return;
			const selector =
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
			const inside = [...panelRef.current.querySelectorAll(selector)];
			if (event.shiftKey && document.activeElement === inside[0]) {
				event.preventDefault();
				close();
			} else if (!event.shiftKey && document.activeElement === inside.at(-1)) {
				// A portal lives at the end of body. Continue after its trigger in
				// the header rather than sending Tab into browser chrome.
				const controls = [...document.querySelectorAll(selector)].filter(
					(element) =>
						!panelRef.current.contains(element) && element.getClientRects().length && element.tabIndex >= 0
				);
				const next = controls[controls.indexOf(triggerRef.current) + 1];
				event.preventDefault();
				close(false);
				(next || triggerRef.current)?.focus();
			}
		}
		function resized() {
			close();
		}
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		document.addEventListener("keydown", keydown);
		window.addEventListener("resize", resized);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
			document.removeEventListener("keydown", keydown);
			window.removeEventListener("resize", resized);
		};
	}, [open]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				onClick={() => setOpen((value) => !value)}
				className={cx(
					linkClass,
					"justify-between gap-3 border",
					allPages ? "w-full border-border bg-surface" : "border-transparent",
					current && !allPages && "bg-accent-soft text-accent-soft-fg"
				)}
			>
				{allPages && <Menu size={18} className="shrink-0" aria-hidden="true" />}
				<span className="min-w-0 flex-1 text-start">
					<span className={cx(current && "block text-xs text-content-muted")}>{__(label)}</span>
					{current && <span className="block break-words font-medium">{__(current.label)}</span>}
				</span>
				<ChevronDown size={15} aria-hidden="true" className={cx("shrink-0", open && "rotate-180")} />
			</button>
			{open &&
				pos &&
				createPortal(
					<div
						ref={panelRef}
						id={panelId}
						role="dialog"
						aria-labelledby={titleId}
						dir={document.documentElement.dir || "ltr"}
						style={popoverStyle(pos)}
						className="overflow-y-auto rounded-xl border border-border-strong bg-surface p-2 text-content shadow-xl"
					>
						<div className="mb-1 flex items-center justify-between gap-2 border-b border-border pb-2 ps-3">
							<h2 id={titleId} className="text-sm font-semibold">
								{__(label)}
							</h2>
							<button
								type="button"
								aria-label={__("Close navigation")}
								onClick={() => close()}
								className={cx(linkClass, "justify-center px-2 hover:bg-surface-2")}
							>
								<X size={18} aria-hidden="true" />
							</button>
						</div>
						<nav aria-label={__(label)} className="space-y-2">
							{groups.map(({ label: groupLabel, links }, index) => (
								<div key={groupLabel || index}>
									{groupLabel && allPages && (
										<h3 className="px-3 pb-1 pt-2 text-xs font-semibold text-content-muted">
											{__(groupLabel)}
										</h3>
									)}
									<div className="space-y-1">
										{links.map((link) => (
											<PageLink
												key={link.to || link.href}
												link={link}
												active={link === activeLink}
												onSelect={() => close()}
												panel
											/>
										))}
									</div>
								</div>
							))}
						</nav>
					</div>,
					document.body
				)}
		</>
	);
}

// Optional group labels let large products organize routes without changing the
// flat links contract used by smaller apps. Route permissions stay in consumers.
export default function PageNavigation({ links }) {
	const location = useLocation();
	const base = useResolvedPath("/").pathname.replace(/\/$/, "");
	function matches(link) {
		if (!link.to) return false;
		const path = `${base}${link.to}`.replace(/\/$/, "") || "/";
		const current = location.pathname.replace(/\/$/, "") || "/";
		return current === path || (!link.end && current.startsWith(`${path}/`));
	}
	const activeLink = links.filter(matches).sort((a, b) => b.to.length - a.to.length)[0];
	const groups = [];
	for (const link of links) {
		let group = groups.find((group) => group.label === (link.group || ""));
		if (!group) {
			group = { label: link.group || "", links: [] };
			groups.push(group);
		}
		group.links.push(link);
	}
	const grouped = links.length > 4;
	return (
		<div className="min-w-0 flex-1">
			<div className={grouped ? "xl:hidden" : "md:hidden"}>
				<PageDisclosure label="Pages" current={activeLink} groups={groups} activeLink={activeLink} allPages />
			</div>
			<nav
				aria-label={__("Pages")}
				className={cx("hidden flex-wrap items-center gap-1", grouped ? "xl:flex" : "md:flex")}
			>
				{grouped
					? groups.map((group) =>
							group.label ? (
								<PageDisclosure
									key={group.label}
									label={group.label}
									current={group.links.includes(activeLink) ? activeLink : null}
									groups={[group]}
									activeLink={activeLink}
								/>
							) : (
								group.links.map((link) => (
									<PageLink key={link.to || link.href} link={link} active={link === activeLink} />
								))
							)
						)
					: links.map((link) => (
							<PageLink key={link.to || link.href} link={link} active={link === activeLink} />
						))}
			</nav>
		</div>
	);
}
