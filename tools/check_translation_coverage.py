#!/usr/bin/env python3
"""Read-only Arabic coverage audit for an app and the shared Sanawbar catalogue.

Uses Python's AST and an existing @babel/parser installation; installs nothing.
Missing literal keys fail with exit 1; parse/configuration errors exit 2. Dynamic
expressions and unwrapped JSX are review candidates, never claimed as covered.

Example:
  python3 tools/check_translation_coverage.py --app ../mfg_suite --shared . \
    --frontend ../mfg_suite/mfg/src --node-modules ../mfg_suite/mfg/node_modules

--manual-keys accepts a JSON list of explicitly reviewed display strings, or a
mapping of display string to a context/location. It does not resolve expressions.
"""

import argparse
import ast
import json
import os
from pathlib import Path
import re
import subprocess
import sys

EXCLUDED = {
	".git",
	".venv",
	"env",
	"venv",
	"node_modules",
	"vendor",
	"assets",
	"dist",
	"build",
	"coverage",
	"__pycache__",
	"tests",
	"test",
	"validation",
	"translations",
	"tools",
	"generated",
	".pytest_cache",
}
QUOTED = r"(?:'[^'\\]*(?:\\.[^'\\]*)*'|\"[^\"\\]*(?:\\.[^\"\\]*)*\")"
TEMPLATE_CALL = re.compile(
	rf"\b(?:_|frappe\._)\(\s*(?P<message>{QUOTED})(?:\s*,\s*context\s*=\s*(?P<context>{QUOTED}))?\s*\)"
)
DISPLAY_KEYS = {"label", "description", "placeholder", "message", "title", "help"}


def source_files(root):
	for directory, dirs, files in os.walk(root, followlinks=False):
		dirs[:] = sorted(d for d in dirs if d not in EXCLUDED and not d.startswith("."))
		for name in sorted(files):
			if (
				name in {"package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
				or name.endswith(".min.js")
				or name.startswith("tsconfig")
			):
				continue
			path = Path(directory) / name
			if name.startswith("test_") or re.search(r"\.(?:test|spec)\.", name):
				continue
			# Vite output entry points are generated, unlike authored public/js.
			if "public" in path.parts and any(
				part in {"mfg", "cheques"} for part in path.relative_to(root).parts
			):
				continue
			yield path


def scan_template(text, path, report, offset=0):
	for match in TEMPLATE_CALL.finditer(text):
		key = ast.literal_eval(match.group("message")).strip()
		if match.group("context"):
			key += ":" + ast.literal_eval(match.group("context"))
		line = offset + text[: match.start()].count("\n") + 1
		report["keys"].setdefault(key, []).append(f"{path}:{line}")
	# Only Jinja output/tag expressions are relevant; don't scan JS scripts here.
	for block in re.finditer(r"{{(.*?)}}|{%(.*?)%}", text, re.S):
		expression = block.group(1) or block.group(2)
		for match in re.finditer(r"\b_\(\s*([^\n]+?)\)", expression):
			if not TEMPLATE_CALL.fullmatch(match.group(0)):
				line = offset + text[: block.start()].count("\n") + 1
				report["dynamic"].append({"location": f"{path}:{line}", "value": match.group(1)})


def scan_python(path, report):
	text = path.read_text(encoding="utf-8")
	try:
		tree = ast.parse(text, filename=str(path))
	except SyntaxError as error:
		report["errors"].append({"location": f"{path}:{error.lineno}", "error": str(error)})
		return
	for node in ast.walk(tree):
		if isinstance(node, ast.Call):
			func = node.func
			translated = (isinstance(func, ast.Name) and func.id == "_") or (
				isinstance(func, ast.Attribute)
				and func.attr == "_"
				and isinstance(func.value, ast.Name)
				and func.value.id == "frappe"
			)
			if translated:
				arg = node.args[0] if node.args else None
				location = f"{path}:{node.lineno}"
				if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
					key = arg.value.strip()
					context = next(
						(item.value for item in node.keywords if item.arg == "context"),
						node.args[2] if len(node.args) > 2 else None,
					)
					if isinstance(context, ast.Constant) and isinstance(context.value, str) and context.value:
						key += ":" + context.value
					elif context is not None and not (
						isinstance(context, ast.Constant) and context.value is None
					):
						report["dynamic"].append(
							{"location": location, "value": "context=" + ast.unparse(context)}
						)
					report["keys"].setdefault(key, []).append(location)
				else:
					report["dynamic"].append(
						{"location": location, "value": ast.unparse(arg) if arg else "<missing argument>"}
					)
		if isinstance(node, ast.Dict):
			for key, value in zip(node.keys, node.values):
				if (
					isinstance(key, ast.Constant)
					and key.value in DISPLAY_KEYS
					and isinstance(value, ast.Constant)
					and isinstance(value.value, str)
					and value.value.strip()
				):
					report["keys"].setdefault(value.value.strip(), []).append(
						f"{path}:{value.lineno}#metadata"
					)
		if (
			isinstance(node, ast.Constant)
			and isinstance(node.value, str)
			and ("{{" in node.value or "{%" in node.value)
		):
			scan_template(node.value, path, report, node.lineno - 1)


def scan_metadata(path, report):
	text = path.read_text(encoding="utf-8")
	try:
		data = json.loads(text)
	except ValueError as error:
		report["errors"].append({"location": str(path), "error": str(error)})
		return

	def add(value, context):
		if value.strip() and re.search(r"[A-Za-z\u0600-\u06ff]", value):
			# JSON pointer/context avoids falsely precise line numbers for repeats.
			report["keys"].setdefault(value.strip(), []).append(f"{path}#{context}")

	def walk(value, pointer=""):
		if isinstance(value, dict):
			if value.get("doctype") in {"DocType", "Print Format", "Report", "Workspace"} and isinstance(
				value.get("name"), str
			):
				add(value["name"], f"{pointer}/name")
			for key, child in value.items():
				context = f"{pointer}/{key}"
				if key in DISPLAY_KEYS and isinstance(child, str):
					add(child, context)
				if (
					key == "options"
					and value.get("fieldtype") == "Select"
					and value.get("fieldname") != "naming_series"
					and isinstance(child, str)
				):
					for option in child.splitlines():
						add(option, context)
				walk(child, context)
		elif isinstance(value, list):
			for index, child in enumerate(value):
				walk(child, f"{pointer}/{index}")

	walk(data)


def load_catalogues(roots, lang):
	catalogue, paths = {}, []
	for root in roots:
		candidates = [
			root / "translations" / f"{lang}.json",
			*sorted(root.glob(f"*/translations/{lang}.json")),
		]
		for path in candidates:
			if path.is_file() and str(path) not in paths:
				values = json.loads(path.read_text(encoding="utf-8"))
				if not isinstance(values, dict):
					raise ValueError(f"Expected JSON catalogue object: {path}")
				catalogue.update(values)
				paths.append(str(path))
	return catalogue, paths


def audit(args):
	app = Path(args.app).resolve()
	shared = Path(args.shared).resolve()
	if not app.is_dir() or not shared.is_dir():
		raise ValueError("--app and --shared must be existing directories")
	roots = list(dict.fromkeys([shared, app]))
	catalogue, paths = load_catalogues(roots, args.lang)
	if not paths:
		raise ValueError(f"No {args.lang}.json translation catalogues found")
	report = {"app": str(app), "catalogues": paths, "keys": {}, "dynamic": [], "unwrapped": [], "errors": []}
	js_files = set()
	for root in roots:
		for path in source_files(root):
			if path.suffix == ".py":
				scan_python(path, report)
			elif path.suffix == ".json":
				scan_metadata(path, report)
			elif path.suffix in {".html", ".jinja", ".j2"}:
				scan_template(path.read_text(encoding="utf-8"), path, report)
			elif path.suffix in {".js", ".jsx", ".ts", ".tsx"}:
				js_files.add(str(path))
	for group in args.frontend or []:
		for directory in group:
			root = Path(directory).resolve()
			if not root.is_dir():
				raise ValueError(f"Frontend directory does not exist: {root}")
			js_files.update(
				str(path) for path in source_files(root) if path.suffix in {".js", ".jsx", ".ts", ".tsx"}
			)
	if js_files:
		if not args.node_modules:
			raise ValueError("--node-modules is required to scan JS/JSX using an existing @babel/parser")
		process = subprocess.run(
			[args.node, str(Path(__file__).with_name("translation_ast.cjs"))],
			input=json.dumps(
				{"files": sorted(js_files), "node_modules": str(Path(args.node_modules).resolve())}
			),
			text=True,
			capture_output=True,
			check=False,
		)
		if process.returncode:
			raise ValueError(process.stderr.strip() or "JavaScript AST scanner failed")
		js = json.loads(process.stdout)
		for item in js.pop("keys"):
			report["keys"].setdefault(item["value"], []).append(item["location"])
		for category in ("dynamic", "unwrapped", "errors"):
			report[category].extend(js[category])
	for file in args.manual_keys or []:
		values = json.loads(Path(file).read_text(encoding="utf-8"))
		if not isinstance(values, (list, dict)):
			raise ValueError("--manual-keys expects a JSON list or object")
		for key in values:
			if not isinstance(key, str):
				raise ValueError("Manual translation keys must be strings")
			report["keys"].setdefault(key, []).append(f"{Path(file).resolve()}#manual")
	report["missing"] = {
		key: sorted(set(locations))
		for key, locations in sorted(report.pop("keys").items())
		if key and not catalogue.get(key)
	}
	report["summary"] = {
		"missing": len(report["missing"]),
		"dynamic": len(report["dynamic"]),
		"unwrapped": len(report["unwrapped"]),
		"errors": len(report["errors"]),
	}
	return report


def main():
	parser = argparse.ArgumentParser(
		description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
	)
	parser.add_argument("--app", required=True)
	parser.add_argument("--shared", required=True)
	parser.add_argument(
		"--frontend", nargs="+", action="append", help="Additional frontend source directories"
	)
	parser.add_argument("--node-modules", help="Existing node_modules containing @babel/parser")
	parser.add_argument("--node", default="node")
	parser.add_argument("--lang", default="ar")
	parser.add_argument("--manual-keys", action="append")
	parser.add_argument(
		"--output", help="Optional JSON report path; source/catalogue files are never modified"
	)
	args = parser.parse_args()
	try:
		report = audit(args)
	except (OSError, ValueError, json.JSONDecodeError) as error:
		parser.exit(2, f"Coverage check failed: {error}\n")
	payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
	if args.output:
		Path(args.output).write_text(payload, encoding="utf-8")
	else:
		print(payload, end="")
	print(json.dumps(report["summary"]), file=sys.stderr)
	return 2 if report["errors"] else 1 if report["missing"] else 0


if __name__ == "__main__":
	raise SystemExit(main())
