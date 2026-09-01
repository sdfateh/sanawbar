// Colour scheme: "light", "dark" or "system". Stored per browser, because it is
// a viewing preference rather than something the ERPNext user record should own.

import { useEffect, useState } from "react";

const KEY = "sanawbar:theme";
const LEGACY_KEY = "mfg:theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function storedTheme() {
	try {
		const value = window.localStorage.getItem(KEY) || window.localStorage.getItem(LEGACY_KEY);
		return value === "light" || value === "dark" ? value : "system";
	} catch {
		// Private mode can block storage; fall back to following the OS.
		return "system";
	}
}

export function resolveTheme(theme) {
	return theme === "system" ? (media().matches ? "dark" : "light") : theme;
}

export function applyTheme(theme) {
	document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

/**
 * Applied before React mounts (see main.jsx) so the first paint is already in
 * the right scheme instead of flashing light.
 */
export function initTheme() {
	applyTheme(storedTheme());
}

export function useTheme() {
	const [theme, setThemeState] = useState(storedTheme);

	useEffect(() => {
		applyTheme(theme);
		if (theme !== "system") return;

		// Only track the OS while the user has not made an explicit choice.
		const query = media();
		const onChange = () => applyTheme("system");
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [theme]);

	function setTheme(next) {
		setThemeState(next);
		try {
			if (next === "system") window.localStorage.removeItem(KEY);
			else window.localStorage.setItem(KEY, next);
			window.localStorage.removeItem(LEGACY_KEY);
		} catch {
			/* preference simply will not persist */
		}
	}

	return { theme, resolved: resolveTheme(theme), setTheme };
}
