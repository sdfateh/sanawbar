import { Eraser, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { __ } from "../lib/i18n";
import { Alert, Button } from "./ui";

let signatureLibraryPromise;

function loadScript(id, src) {
	const existing = document.getElementById(id);
	if (existing) {
		if (existing.dataset.loaded === "true") return Promise.resolve();
		return new Promise((resolve, reject) => {
			existing.addEventListener("load", resolve, { once: true });
			existing.addEventListener("error", reject, { once: true });
		});
	}
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.id = id;
		script.src = src;
		script.onload = () => {
			script.dataset.loaded = "true";
			resolve();
		};
		script.onerror = reject;
		document.head.appendChild(script);
	});
}

function loadFrappeSignatureLibrary() {
	if (!signatureLibraryPromise) {
		signatureLibraryPromise = (async () => {
			if (!window.jQuery) {
				await loadScript("sanawbar-frappe-jquery", "/assets/frappe/js/lib/jquery/jquery.min.js");
			}
			if (!window.jQuery?.fn?.jSignature) {
				await loadScript("sanawbar-frappe-jsignature", "/assets/frappe/js/lib/jSignature.min.js");
			}
		})();
	}
	return signatureLibraryPromise;
}

/** Shared portal adapter for the same jSignature control used by Frappe Desk. */
export default function SignaturePad({ value, onChange, disabled }) {
	const mountRef = useRef(null);
	const padRef = useRef(null);
	const loadingRef = useRef(false);
	const onChangeRef = useRef(onChange);
	const initialValueRef = useRef(value);
	const [error, setError] = useState("");

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(() => {
		let cancelled = false;
		const mount = mountRef.current;
		async function initialize() {
			try {
				await loadFrappeSignatureLibrary();
				if (cancelled || !mount) return;
				const $pad = window.jQuery(mount).jSignature({
					height: 144,
					width: mount.clientWidth,
					lineWidth: 2,
					color: "#000",
					backgroundColor: "#fff",
				});
				padRef.current = $pad;
				if (initialValueRef.current) {
					loadingRef.current = true;
					$pad.jSignature("setData", initialValueRef.current);
					loadingRef.current = false;
				}
				$pad.on("change.sanawbar-signature", () => {
					if (!loadingRef.current) onChangeRef.current?.($pad.jSignature("getData"));
				});
			} catch {
				if (!cancelled) {
					setError(__("The signature control could not be loaded. Upload a signature image instead."));
				}
			}
		}
		initialize();
		return () => {
			cancelled = true;
			padRef.current?.off("change.sanawbar-signature");
			padRef.current = null;
			mount?.replaceChildren();
		};
	}, []); // The Frappe control is created once per mounted action dialog.

	useEffect(() => {
		const $pad = padRef.current;
		if (!$pad) return;
		loadingRef.current = true;
		$pad.jSignature("reset");
		if (value) $pad.jSignature("setData", value);
		loadingRef.current = false;
	}, [value]);

	function clear() {
		loadingRef.current = true;
		padRef.current?.jSignature("reset");
		loadingRef.current = false;
		onChange?.("");
	}

	function upload(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			setError(__("Choose an image file for the signature."));
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			setError("");
			onChange?.(String(reader.result || ""));
		};
		reader.onerror = () => setError(__("The signature image could not be read."));
		reader.readAsDataURL(file);
	}

	return (
		<div className="space-y-2">
			{error && <Alert tone="danger">{error}</Alert>}
			<div
				className="overflow-hidden rounded-xl border border-border-strong bg-white"
				aria-label={__("Signature pad")}
				aria-disabled={disabled}
			>
				<div ref={mountRef} className={disabled ? "pointer-events-none opacity-60" : undefined} />
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="min-w-48 grow text-xs text-content-muted">
					{__("Sign with a finger or mouse. Your logged-in identity is recorded automatically.")}
				</p>
				<label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-accent">
					<Upload size={15} aria-hidden="true" />
					{__("Upload signature image")}
					<input className="sr-only" type="file" accept="image/*" onChange={upload} disabled={disabled} />
				</label>
				<Button type="button" size="lg" variant="ghost" icon={Eraser} onClick={clear} disabled={disabled}>
					{__("Clear")}
				</Button>
			</div>
		</div>
	);
}
