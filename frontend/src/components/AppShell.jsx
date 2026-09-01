import { ChevronDown, ExternalLink, LogOut, Monitor, Moon, RotateCw, Sun, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useBlocker } from "react-router-dom";

import ConfirmDialog from "./ConfirmDialog";
import { Button, cx } from "./ui";
import { clearCache, logout } from "../lib/api";
import { hasUnsavedChanges, subscribeDirtyGuards } from "../lib/dirtyGuard";
import { __, getAppConfig, isRTL } from "../lib/i18n";
import { popoverStyle, usePopoverPosition } from "../lib/popover";
import { useTheme } from "../lib/theme";

// The shared shell takes navigation from whichever product mounted it. Each app
// keeps its own route and permission gate while sharing the header, theme,
// cache controls, and dirty guard.
//
// A link with `to` is a router link inside the current page; a link with `href`
// leaves for another app, which lives under a different basename and would
// otherwise resolve inside the current router.

const THEMES = [
	{ value: "light", icon: Sun, label: "Light" },
	{ value: "dark", icon: Moon, label: "Dark" },
	{ value: "system", icon: Monitor, label: "System" },
];

function ThemeToggle() {
	const { theme, setTheme } = useTheme();

	return (
		<div
			role="radiogroup"
			aria-label={__("Colour theme")}
			className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1"
		>
			{THEMES.map(({ value, icon: Icon, label }) => (
				<button
					key={value}
					type="button"
					role="radio"
					aria-checked={theme === value}
					onClick={() => setTheme(value)}
					className={cx(
						"flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 text-2xs transition-colors",
						theme === value
							? "bg-surface text-content shadow-xs"
							: "text-content-faint hover:text-content"
					)}
				>
					<Icon size={14} />
					<span>{__(label)}</span>
				</button>
			))}
		</div>
	);
}

function initials(name) {
	return String(name || "")
		.trim()
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => [...part][0] || "")
		.join("")
		.toUpperCase();
}

function UserAvatar({ user, className }) {
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [user?.image]);
	return (
		<span
			className={cx(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-fg",
				className
			)}
		>
			{user?.image && !failed ? (
				<img
					src={user.image}
					alt=""
					className="h-full w-full object-cover"
					onError={() => setFailed(true)}
				/>
			) : initials(user?.full_name) ? (
				initials(user.full_name)
			) : (
				<UserRound size={16} />
			)}
		</span>
	);
}

function ProfileMenu({ deskHref, clearing, loggingOut, onClearCache, onLogout }) {
	const user = getAppConfig().user || {};
	const [open, setOpen] = useState(false);
	const triggerRef = useRef(null);
	const panelRef = useRef(null);
	const panelId = useId();
	const pos = usePopoverPosition(triggerRef, open, { maxHeight: 520, minWidth: 320 });

	useEffect(() => {
		if (!open) return undefined;
		function outside(event) {
			if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
			setOpen(false);
		}
		function onKeyDown(event) {
			if (event.key !== "Escape") return;
			setOpen(false);
			triggerRef.current?.focus();
		}
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	useEffect(() => {
		if (!open || !pos) return undefined;
		const frame = requestAnimationFrame(() => panelRef.current?.querySelector("button, a")?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open, pos]);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				aria-label={__("Open user menu")}
				onClick={() => setOpen((value) => !value)}
				className={cx(
					"flex min-h-11 items-center gap-2 rounded-full border px-1.5 pe-2 transition-colors",
					open
						? "border-accent bg-accent-soft text-accent-soft-fg"
						: "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
				)}
			>
				<UserAvatar user={user} className="h-7 w-7" />
				<span className="hidden max-w-36 truncate text-xs font-medium lg:inline">
					{user.full_name || user.email || __("Account")}
				</span>
				<ChevronDown size={13} className={cx("text-content-faint transition-transform", open && "rotate-180")} />
			</button>

			{open && pos &&
				createPortal(
					<div
						ref={panelRef}
						id={panelId}
						role="dialog"
						aria-label={__("User menu")}
						dir={document.documentElement.dir || "ltr"}
						style={popoverStyle(pos)}
						className="animate-scale-in overflow-auto rounded-xl border border-border-strong bg-surface p-2 shadow-xl"
					>
						<div className="flex items-center gap-3 border-b border-border p-2 pb-3">
							<UserAvatar user={user} className="h-11 w-11 text-sm" />
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold">{user.full_name || user.email}</p>
								<p className="truncate text-2xs text-content-muted" dir="ltr">
									{user.email || user.id}
								</p>
							</div>
						</div>

						<div className="border-b border-border px-2 py-3">
							<p className="mb-2 text-2xs font-medium uppercase tracking-wide text-content-faint">
								{__("Colour theme")}
							</p>
							<ThemeToggle />
						</div>

						<div className="space-y-1 pt-2">
							<a
								href={deskHref}
								className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-content-muted transition-colors hover:bg-surface-2 hover:text-content"
							>
								<ExternalLink size={15} className={isRTL ? "-scale-x-100" : ""} />
								<span className="grow">{__("Desk view")}</span>
							</a>
							<button
								type="button"
								disabled={clearing}
								onClick={() => {
									setOpen(false);
									onClearCache();
								}}
								className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-start text-sm text-content-muted transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-50"
							>
								<RotateCw size={15} className={clearing ? "animate-spin" : ""} />
								<span>{__("Clear Cache")}</span>
							</button>
							<Button
								variant="ghost"
								size="lg"
								block
								icon={LogOut}
								busy={loggingOut}
								disabled={loggingOut}
								onClick={() => {
									setOpen(false);
									onLogout();
								}}
								className="!justify-start text-danger hover:bg-danger-soft hover:text-danger"
							>
								{__("Log out")}
							</Button>
						</div>
					</div>,
					document.body
				)}
		</>
	);
}

export default function AppShell({ brand, links: navLinks = [], deskHref }) {
	const [clearing, setClearing] = useState(false);
	const [loggingOut, setLoggingOut] = useState(false);
	const [discardPrompt, setDiscardPrompt] = useState(null);
	const dirty = useSyncExternalStore(subscribeDirtyGuards, hasUnsavedChanges, () => false);
	const blocker = useBlocker(dirty);
	const dirtyRef = useRef(dirty);
	dirtyRef.current = dirty;
	const links = navLinks.filter((link) => link.show !== false);
	const BrandIcon = brand?.icon;

	async function clearConfirmed() {
		setClearing(true);
		try {
			await clearCache(); // reloads the page on success
		} catch (e) {
			setClearing(false);
			window.alert(e.message || __("Could not clear cache"));
		}
	}

	function onClearCache() {
		if (!dirty) {
			clearConfirmed();
			return;
		}
		setDiscardPrompt({
			onConfirm: () => {
				setDiscardPrompt(null);
				clearConfirmed();
			},
			onCancel: () => setDiscardPrompt(null),
		});
	}

	async function logoutConfirmed() {
		setLoggingOut(true);
		try {
			await logout();
		} catch (e) {
			setLoggingOut(false);
			window.alert(e.message || __("Could not log out"));
		}
	}

	function onLogout() {
		setDiscardPrompt({
			title: __("Log out?"),
			message: dirty
				? __("You have unsaved changes. They will be lost if you log out.")
				: __("Are you sure you want to log out?"),
			confirmLabel: __("Log out"),
			cancelLabel: __("Cancel"),
			onConfirm: () => {
				setDiscardPrompt(null);
				logoutConfirmed();
			},
			onCancel: () => setDiscardPrompt(null),
		});
	}

	useEffect(() => {
		if (blocker.state !== "blocked") return;
		setDiscardPrompt({
			onConfirm: () => {
				setDiscardPrompt(null);
				blocker.proceed();
			},
			onCancel: () => {
				setDiscardPrompt(null);
				blocker.reset();
			},
		});
	}, [blocker]);

	useEffect(() => {
		function onBeforeUnload(e) {
			if (window.__sanawbarSkipUnloadPrompt || !dirtyRef.current) return;
			e.preventDefault();
			e.returnValue = "";
			return "";
		}
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, []);

	return (
		<div className="min-h-screen bg-bg text-content">
			<ConfirmDialog
				open={Boolean(discardPrompt)}
				title={discardPrompt?.title}
				message={discardPrompt?.message}
				confirmLabel={discardPrompt?.confirmLabel}
				cancelLabel={discardPrompt?.cancelLabel}
				onConfirm={discardPrompt?.onConfirm}
				onCancel={discardPrompt?.onCancel}
			/>
			<header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur-md">
				<div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
					<span className="flex items-center gap-2">
						<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg">
							{BrandIcon ? <BrandIcon size={15} /> : null}
						</span>
						<span className="hidden text-sm font-semibold tracking-tight sm:inline">
							{__(brand?.label || "Application")}
						</span>
					</span>

					{/* A single-screen page passes no links; an empty bar would just be
					    a gap next to the wordmark. */}
					<nav className={cx("ms-2 items-center gap-0.5", links.length ? "flex" : "hidden")}>
						{links.map(({ to, href, label, icon: Icon, end }) =>
							href ? (
								<a
									key={href}
									href={href}
									className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-content-muted transition-colors hover:bg-surface-3 hover:text-content sm:px-3"
								>
									<Icon size={15} />
									<span className="hidden sm:inline">{__(label)}</span>
								</a>
							) : (
							<NavLink
								key={to}
								to={to}
								end={end}
								className={({ isActive }) =>
									cx(
										"flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors sm:px-3",
										isActive
											? "bg-accent-soft font-medium text-accent-soft-fg"
											: "text-content-muted hover:bg-surface-3 hover:text-content"
									)
								}
							>
								<Icon size={15} />
								<span className="hidden sm:inline">{__(label)}</span>
							</NavLink>
							)
						)}
					</nav>

					<div className="ms-auto">
						<ProfileMenu
							deskHref={deskHref}
							clearing={clearing}
							loggingOut={loggingOut}
							onClearCache={onClearCache}
							onLogout={onLogout}
						/>
					</div>
				</div>
			</header>

			<main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
				<Outlet />
			</main>
		</div>
	);
}
