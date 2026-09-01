import { locale } from "../lib/i18n";

// Renders a number using the user's locale rules for the given currency.
// Numerals stay Western even in Arabic (see `locale` in lib/i18n) because that
// is how ERPNext stores and displays costs; only the layout direction flips.
// Falls back to a plain fixed-decimal string for currencies Intl doesn't know.
export default function Money({ value, currency, precision, negative = false }) {
	if (value === null || value === undefined || value === "") return <span>—</span>;

	const num = Number(value);
	if (Number.isNaN(num)) return <span>—</span>;

	try {
		return (
			<span dir="ltr" style={{ display: "inline-block" }}>
				{new Intl.NumberFormat(locale, {
					style: "currency",
					currency: currency || "USD",
					minimumFractionDigits: precision ?? undefined,
					maximumFractionDigits: precision ?? undefined,
					currencyDisplay: "narrowSymbol",
				}).format(negative && num ? -Math.abs(num) : num)}
			</span>
		);
	} catch {
		return <span dir="ltr">{(negative && num ? -Math.abs(num) : num).toFixed(precision ?? 2)}</span>;
	}
}
