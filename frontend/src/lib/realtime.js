import { io } from "socket.io-client";

import { getAppConfig } from "./i18n";

let socket = null;
const doctypeSubscriptions = new Map();

function getRealtimeConfig() {
	return getAppConfig().realtime || {};
}

function resubscribe() {
	for (const doctype of doctypeSubscriptions.keys()) {
		socket.emit("doctype_subscribe", doctype);
	}
}

export function getRealtimeClient() {
	const config = getRealtimeConfig();
	if (config.enabled === false || !config.site_name) return null;

	if (!socket) {
		const namespace = `/${String(config.site_name).replace(/^\/+/, "")}`;
		socket = io(`${window.location.origin}${namespace}`, {
			withCredentials: true,
		});
		socket.on("connect", resubscribe);
	}

	return socket;
}

export function initRealtime() {
	return getRealtimeClient();
}

export function onRealtime(event, handler) {
	const client = getRealtimeClient();
	if (!client) return () => {};

	client.on(event, handler);
	return () => client.off(event, handler);
}

export function subscribeDoctype(doctype) {
	const client = getRealtimeClient();
	if (!client || !doctype) return () => {};

	const count = doctypeSubscriptions.get(doctype) || 0;
	doctypeSubscriptions.set(doctype, count + 1);
	if (count === 0 && client.connected) client.emit("doctype_subscribe", doctype);

	return () => {
		const remaining = (doctypeSubscriptions.get(doctype) || 1) - 1;
		if (remaining > 0) {
			doctypeSubscriptions.set(doctype, remaining);
			return;
		}
		doctypeSubscriptions.delete(doctype);
		if (client.connected) client.emit("doctype_unsubscribe", doctype);
	};
}
