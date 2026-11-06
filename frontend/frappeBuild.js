import path from "node:path";
import { pid } from "node:process";
import { copyFile, rename, rm } from "node:fs/promises";

/** Publish a Frappe SPA entry after each normal or --watch build.
 *
 * App-owned paths are explicit so a temporary --outDir build cannot replace a
 * live Frappe template with references to assets outside its public folder.
 */
export function publishFrappeEntry({ name, assetsDir, htmlEntry }) {
	const canonicalAssets = path.resolve(assetsDir);
	const targetEntry = path.resolve(htmlEntry);
	return {
		name: `${name}-publish-frappe-entry`,
		apply: "build",
		async writeBundle(output, bundle) {
			if (!output.dir || path.resolve(output.dir) !== canonicalAssets || !bundle["index.html"]) return;
			const temporaryEntry = `${targetEntry}.${pid}.tmp`;
			try {
				await copyFile(path.join(output.dir, "index.html"), temporaryEntry);
				await rename(temporaryEntry, targetEntry);
			} finally {
				await rm(temporaryEntry, { force: true });
			}
		},
	};
}
