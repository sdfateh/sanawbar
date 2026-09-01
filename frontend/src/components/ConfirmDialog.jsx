import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "./ui";
import { __ } from "../lib/i18n";

/**
 * Blocking confirmation dialog. Rendered in a portal so no ancestor's overflow
 * or stacking context can clip it.
 */
export default function ConfirmDialog({
	open,
	title,
	message,
	children,
	initialFocusRef,
	confirmLabel,
	cancelLabel,
	danger = true,
	onConfirm,
	onCancel,
}) {
	const cancelRef = useRef(null);
	const titleId = useId();

	// Focus an explicit input when supplied; otherwise keep the safe choice focused.
	useEffect(() => {
		if (open) (initialFocusRef?.current || cancelRef.current)?.focus();
	}, [open, initialFocusRef]);

	useEffect(() => {
		if (!open) return;
		function onKey(e) {
			if (e.key === "Escape") onCancel?.();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onCancel]);

	if (!open) return null;

	return createPortal(
		<div
			className="fixed inset-0 z-[10000] flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
			onMouseDown={(e) => {
				// Only a click on the backdrop itself dismisses.
				if (e.target === e.currentTarget) onCancel?.();
			}}
		>
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby={titleId}
				dir={document.documentElement.dir || "ltr"}
				className="w-full max-w-md animate-scale-in rounded-2xl border border-border bg-surface p-5 shadow-lg"
			>
				<div className="flex items-start gap-3">
					{danger && (
						<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
							<AlertTriangle size={16} />
						</span>
					)}
					<div className="min-w-0">
						<h2 id={titleId} className="text-sm font-semibold">
							{title || __("Discard unsaved changes?")}
						</h2>
						<p className="mt-1 text-sm text-content-muted">
							{message || __("You have unsaved changes. They will be lost if you continue.")}
						</p>
						{children}
					</div>
				</div>

				<div className="mt-5 flex justify-end gap-2">
					<Button ref={cancelRef} onClick={onCancel}>
						{cancelLabel || __("Keep editing")}
					</Button>
					<Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
						{confirmLabel || __("Discard changes")}
					</Button>
				</div>
			</div>
		</div>,
		document.body
	);
}
