import { AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { useState } from "react";

import { captureSentryTestError } from "../lib/sentry";
import { Alert, Button, PageHeader } from "./ui";

const identity = (value) => value;

export default function SentryTestPage({ product, translate = identity }) {
	const [sending, setSending] = useState(false);
	const [result, setResult] = useState(null);

	async function sendTestError() {
		setSending(true);
		setResult(null);
		try {
			const eventId = await captureSentryTestError(product);
			setResult(eventId ? { tone: "success", eventId } : { tone: "warning", eventId: null });
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="mx-auto max-w-2xl space-y-5 py-4">
			<PageHeader
				title={translate("Sentry verification")}
				description={translate("Temporary deployment diagnostic for {0}.", [product])}
			/>

			<section className="space-y-4 border-y border-border py-5">
				<Alert tone="warning" icon={AlertTriangle}>
					{translate("This intentionally records a browser error. Remove this page after verification.")}
				</Alert>
				<Button
					type="button"
					variant="danger"
					size="lg"
					icon={Send}
					busy={sending}
					onClick={sendTestError}
				>
					{translate("Send test error")}
				</Button>
			</section>

			{result?.tone === "success" && (
				<Alert tone="success" icon={CheckCircle2}>
					<p>{translate("The test error was queued and flushed to Sentry.")}</p>
					<p className="mt-1 break-all font-mono text-xs" dir="ltr">
						{translate("Event ID")}: {result.eventId}
					</p>
				</Alert>
			)}

			{result?.tone === "warning" && (
				<Alert tone="warning" icon={AlertTriangle}>
					{translate("Sentry is disabled or the event could not be delivered. Check the bench variables and site telemetry setting.")}
				</Alert>
			)}
		</div>
	);
}
