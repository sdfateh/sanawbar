/* ===========================================================================
   Sanawbar / صنوبر — the single source of truth for colour and type.
   ---------------------------------------------------------------------------
   The palette is declared here as plain hex. A plugin at the bottom emits it
   as CSS custom properties on `:root` and `.dark`, and `theme.colors` maps the
   semantic names onto those properties. So each value is written exactly once,
   the `dark` class still re-themes everything, and Tailwind's alpha modifiers
   (bg-surface/60) keep working.

   The brand is two colours from the logo:

       deep  #0E2419   the pine-cone ground — the app's PRIMARY
       lime  #BEDC50   the mark — the highlight it pairs with

   Three constraints shaped the derived tokens, all measured, not eyeballed:

   1. In light, the primary is the deep green itself with a LIME label.
      That is the logo, and it measures 10.5:1.
   2. In dark, the deep green *is* the surface, so a deep-green button would be
      invisible. The primary lifts to #46A475 — same hue, same family — which
      holds 5.3:1 against the surface and carries a deep-green label at 5.3:1.
   3. The soft/badge tint stays LIME, not green. `success` is a teal-green only
      14 deg from the deep green, so green badges beside green badges would be
      indistinguishable in the operation rail; the lime tint sits 91 deg away.
   =========================================================================== */

const BRAND = {
	deep: "#0E2419",
	lime: "#BEDC50",
};

const LIGHT = {
	bg: "#F5F8F4",
	surface: "#FFFFFF",
	"surface-2": "#F5F8F4",
	"surface-3": "#E9EFE5",

	border: "#DCE4D7",
	"border-strong": "#7C9880",

	text: BRAND.deep,
	muted: "#55665B",
	faint: "#7C8D81",

	accent: BRAND.deep,
	"accent-hover": "#1B4229",
	"accent-fg": BRAND.lime,
	"accent-soft": "#EDF5D5",
	"accent-soft-fg": BRAND.deep,

	success: "#0F7B5F",
	"success-soft": "#E4F4EE",
	"success-soft-fg": "#0A5744",

	warning: "#B4700A",
	"warning-soft": "#FDF3E2",
	"warning-soft-fg": "#845007",

	danger: "#C42B2B",
	"danger-fg": "#FFFFFF",
	"danger-soft": "#FBEAEA",
	"danger-soft-fg": "#8F1F1E",

	ring: "#32855C",
	"shadow-color": BRAND.deep,

	// Chart marks. Not the semantic `success`/`danger` tokens by accident: a
	// badge fill and a data mark have different jobs, and these two were picked
	// by running the palette validator (lightness band, chroma floor, CVD
	// separation, contrast vs surface) rather than by eye. The deep-green accent
	// FAILS as a bar fill - too dark, and it reads gray.
	"chart-bar": "#0F7B5F",
	"chart-alert": "#C42B2B",
};

const DARK = {
	// The logo itself: deep green ground, lime highlight.
	bg: "#08170F",
	surface: BRAND.deep,
	"surface-2": "#143020",
	"surface-3": "#1B3B28",

	border: "#20452F",
	"border-strong": "#447459",

	text: "#E8F2E4",
	muted: "#9DB3A3",
	faint: "#6E8677",

	accent: "#46A475",
	"accent-hover": "#57B385",
	"accent-fg": BRAND.deep,
	"accent-soft": "#2A3A15",
	"accent-soft-fg": "#CBE568",

	success: "#2BB98C",
	"success-soft": "#0A3327",
	"success-soft-fg": "#5FD9AF",

	warning: "#E8A33A",
	"warning-soft": "#3A2C0C",
	"warning-soft-fg": "#F3C46C",

	// A light danger fill needs a dark label; white on it is only 3.35:1.
	danger: "#E86060",
	"danger-fg": "#2A0C0C",
	"danger-soft": "#3D1717",
	"danger-soft-fg": "#F0A0A0",

	ring: BRAND.lime,
	"shadow-color": "#000000",

	// Dark is SELECTED, not flipped: #2BB98C (the dark success token) sits
	// outside the lightness band for a mark, and the dark accent #46A475 fails
	// CVD separation against the alert red (deutan dE 5.2). This teal holds
	// dE 9.2 and passes every check against the deep-green surface.
	"chart-bar": "#2A9D8F",
	"chart-alert": "#E86060",
};

/* Noto Kufi Arabic, self-hosted. The variable file carries 100-900, and the
   subsets are split by unicode-range so a Latin-only user fetches ~30KB of it.
   No external request, so the app still works on a factory LAN with no
   internet - the same reason Inter is loaded from Frappe's own assets. */
const FONT_DIR = "/assets/sanawbar/fonts/noto-kufi-arabic";
const FONT_SUBSETS = [
	{ file: "arabic", range: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1" },
	{ file: "math", range: "U+0302-0303, U+0305, U+0307-0308, U+0310, U+0312, U+0315, U+031A, U+0326-0327, U+032C, U+032F-0330, U+0332-0333, U+0338, U+033A, U+0346, U+034D, U+0391-03A1, U+03A3-03A9, U+03B1-03C9, U+03D1, U+03D5-03D6, U+03F0-03F1, U+03F4-03F5, U+2016-2017, U+2034-2038, U+203C, U+2040, U+2043, U+2047, U+2050, U+2057, U+205F, U+2070-2071, U+2074-208E, U+2090-209C, U+20D0-20DC, U+20E1, U+20E5-20EF, U+2100-2112, U+2114-2115, U+2117-2121, U+2123-214F, U+2190, U+2192, U+2194-21AE, U+21B0-21E5, U+21F1-21F2, U+21F4-2211, U+2213-2214, U+2216-22FF, U+2308-230B, U+2310, U+2319, U+231C-2321, U+2336-237A, U+237C, U+2395, U+239B-23B7, U+23D0, U+23DC-23E1, U+2474-2475, U+25AF, U+25B3, U+25B7, U+25BD, U+25C1, U+25CA, U+25CC, U+25FB, U+266D-266F, U+27C0-27FF, U+2900-2AFF, U+2B0E-2B11, U+2B30-2B4C, U+2BFE, U+3030, U+FF5B, U+FF5D, U+1D400-1D7FF, U+1EE00-1EEFF" },
	{ file: "symbols", range: "U+0001-000C, U+000E-001F, U+007F-009F, U+20DD-20E0, U+20E2-20E4, U+2150-218F, U+2190, U+2192, U+2194-2199, U+21AF, U+21E6-21F0, U+21F3, U+2218-2219, U+2299, U+22C4-22C6, U+2300-243F, U+2440-244A, U+2460-24FF, U+25A0-27BF, U+2800-28FF, U+2921-2922, U+2981, U+29BF, U+29EB, U+2B00-2BFF, U+4DC0-4DFF, U+FFF9-FFFB, U+10140-1018E, U+10190-1019C, U+101A0, U+101D0-101FD, U+102E0-102FB, U+10E60-10E7E, U+1D2C0-1D2D3, U+1D2E0-1D37F, U+1F000-1F0FF, U+1F100-1F1AD, U+1F1E6-1F1FF, U+1F30D-1F30F, U+1F315, U+1F31C, U+1F31E, U+1F320-1F32C, U+1F336, U+1F378, U+1F37D, U+1F382, U+1F393-1F39F, U+1F3A7-1F3A8, U+1F3AC-1F3AF, U+1F3C2, U+1F3C4-1F3C6, U+1F3CA-1F3CE, U+1F3D4-1F3E0, U+1F3ED, U+1F3F1-1F3F3, U+1F3F5-1F3F7, U+1F408, U+1F415, U+1F41F, U+1F426, U+1F43F, U+1F441-1F442, U+1F444, U+1F446-1F449, U+1F44C-1F44E, U+1F453, U+1F46A, U+1F47D, U+1F4A3, U+1F4B0, U+1F4B3, U+1F4B9, U+1F4BB, U+1F4BF, U+1F4C8-1F4CB, U+1F4D6, U+1F4DA, U+1F4DF, U+1F4E3-1F4E6, U+1F4EA-1F4ED, U+1F4F7, U+1F4F9-1F4FB, U+1F4FD-1F4FE, U+1F503, U+1F507-1F50B, U+1F50D, U+1F512-1F513, U+1F53E-1F54A, U+1F54F-1F5FA, U+1F610, U+1F650-1F67F, U+1F687, U+1F68D, U+1F691, U+1F694, U+1F698, U+1F6AD, U+1F6B2, U+1F6B9-1F6BA, U+1F6BC, U+1F6C6-1F6CF, U+1F6D3-1F6D7, U+1F6E0-1F6EA, U+1F6F0-1F6F3, U+1F6F7-1F6FC, U+1F700-1F7FF, U+1F800-1F80B, U+1F810-1F847, U+1F850-1F859, U+1F860-1F887, U+1F890-1F8AD, U+1F8B0-1F8BB, U+1F8C0-1F8C1, U+1F900-1F90B, U+1F93B, U+1F946, U+1F984, U+1F996, U+1F9E9, U+1FA00-1FA6F, U+1FA70-1FA7C, U+1FA80-1FA89, U+1FA8F-1FAC6, U+1FACE-1FADC, U+1FADF-1FAE9, U+1FAF0-1FAF8, U+1FB00-1FBFF" },
	{ file: "latin-ext", range: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF" },
	{ file: "latin", range: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
];

const FONT_STACK = [
	'"Noto Kufi Arabic"',
	// Fallback for anything the Kufi face does not cover; Frappe ships it.
	"InterVariable",
	"-apple-system",
	"BlinkMacSystemFont",
	'"Segoe UI"',
	"Roboto",
	'"Helvetica Neue"',
	"Arial",
	"sans-serif",
];

/* --------------------------------------------------------------------------- */

/** "#0E2419" -> "14 36 25", the channel form Tailwind's alpha modifiers need. */
const channels = (hex) => {
	const v = hex.replace("#", "");
	const n = parseInt(
		v.length === 3
			? v
					.split("")
					.map((c) => c + c)
					.join("")
			: v,
		16
	);
	return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const vars = (map) =>
	Object.fromEntries(Object.entries(map).map(([k, v]) => [`--${k}`, channels(v)]));

const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
	darkMode: "class",
	theme: {
		extend: {
			fontFamily: {
				sans: FONT_STACK,
			},
			colors: {
				// The raw brand pair, for the rare spot that must not re-theme.
				brand: BRAND,

				// Data marks, validated per mode - see the LIGHT/DARK notes.
				chart: {
					bar: token("chart-bar"),
					alert: token("chart-alert"),
				},

				bg: token("bg"),
				surface: {
					DEFAULT: token("surface"),
					2: token("surface-2"),
					3: token("surface-3"),
				},
				border: {
					DEFAULT: token("border"),
					strong: token("border-strong"),
				},
				content: {
					DEFAULT: token("text"),
					muted: token("muted"),
					faint: token("faint"),
				},
				accent: {
					DEFAULT: token("accent"),
					hover: token("accent-hover"),
					fg: token("accent-fg"),
					soft: token("accent-soft"),
					"soft-fg": token("accent-soft-fg"),
				},
				success: {
					DEFAULT: token("success"),
					soft: token("success-soft"),
					"soft-fg": token("success-soft-fg"),
				},
				warning: {
					DEFAULT: token("warning"),
					soft: token("warning-soft"),
					"soft-fg": token("warning-soft-fg"),
				},
				danger: {
					DEFAULT: token("danger"),
					fg: token("danger-fg"),
					soft: token("danger-soft"),
					"soft-fg": token("danger-soft-fg"),
				},
				ring: token("ring"),
			},
			borderColor: { DEFAULT: token("border") },
			borderRadius: {
				lg: "0.625rem",
				xl: "0.875rem",
				"2xl": "1.125rem",
			},
			boxShadow: {
				xs: "0 1px 2px 0 rgb(var(--shadow-color) / 0.05)",
				sm: "0 1px 3px 0 rgb(var(--shadow-color) / 0.07), 0 1px 2px -1px rgb(var(--shadow-color) / 0.05)",
				md: "0 4px 12px -2px rgb(var(--shadow-color) / 0.09), 0 2px 4px -2px rgb(var(--shadow-color) / 0.05)",
				lg: "0 12px 32px -8px rgb(var(--shadow-color) / 0.16), 0 4px 8px -4px rgb(var(--shadow-color) / 0.08)",
			},
			fontSize: {
				"2xs": ["0.6875rem", { lineHeight: "1rem" }],
			},
			keyframes: {
				"fade-in": {
					from: { opacity: "0" },
					to: { opacity: "1" },
				},
				"scale-in": {
					from: { opacity: "0", transform: "translateY(4px) scale(0.98)" },
					to: { opacity: "1", transform: "translateY(0) scale(1)" },
				},
				shimmer: {
					"100%": { transform: "translateX(100%)" },
				},
			},
			animation: {
				"fade-in": "fade-in 0.15s ease-out",
				"scale-in": "scale-in 0.15s ease-out",
			},
		},
	},
	plugins: [
		// Emit the palette and the @font-face set, so index.css holds no colours
		// and no font URLs and this file stays the only place to edit them.
		({ addBase }) => {
			addBase({
				// An array, not repeated keys: one @font-face per subset, each
				// with its own unicode-range so only what is needed downloads.
				"@font-face": FONT_SUBSETS.map(({ file, range }) => ({
					fontFamily: '"Noto Kufi Arabic"',
					fontStyle: "normal",
					fontWeight: "100 900",
					fontDisplay: "swap",
					src: `url("${FONT_DIR}/noto-kufi-arabic-${file}.woff2") format("woff2")`,
					unicodeRange: range,
					// The face declares ascent 128.2% / descent 61.5% - a 1.897em
					// line box, against Inter's 1.210em. Elements that size to the
					// font's own metrics rather than to CSS line-height (a <select>
					// most visibly) then stand taller than the inputs beside them.
					//
					// Measured ink across Arabic letters, tashkeel, Latin and digits
					// needs at most 103.1% up and 44.8% down, so the declared box is
					// padding. Trimming to 104/46 takes the line box to 1.50em -
					// still 24% roomier than Inter, and nothing is clipped.
					ascentOverride: "104%",
					descentOverride: "46%",
					lineGapOverride: "0%",
				})),
				":root": { colorScheme: "light", ...vars(LIGHT) },
				".dark": { colorScheme: "dark", ...vars(DARK) },
			});
		},
	],
};
