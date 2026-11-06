"""Validate JSON translation catalogues and mirror them for native Frappe readers.

JSON remains the source for the SPA and app Python helpers. Frappe Desk, metadata,
reports and Jinja read the generated CSV. Run with --write after editing JSON;
use --check in validation to detect missing or stale native translations.
"""

import argparse
import csv
import io
import json
import re
from collections import Counter
from pathlib import Path

_PLACEHOLDER = re.compile(r"(?<!\{)\{([A-Za-z_]\w*|\d+)(?:![ars])?(?::[^{}]+)?\}(?!\})")
_PERCENT = re.compile(r"(?<!%)%(?:\([^)]+\))?[sdif]")


def _unique_object(pairs):
	result = {}
	for key, value in pairs:
		if key in result:
			raise ValueError(f"Duplicate translation key: {key}")
		result[key] = value
	return result


def placeholders(text):
	return Counter(_PLACEHOLDER.findall(text)) + Counter(_PERCENT.findall(text))


def load_catalogue(path):
	catalogue = json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=_unique_object)
	if not isinstance(catalogue, dict):
		raise ValueError(f"{path}: expected a JSON object")
	for source, translation in catalogue.items():
		if not isinstance(source, str) or not source.strip():
			raise ValueError(f"{path}: empty or invalid source key")
		if not isinstance(translation, str) or not translation.strip():
			raise ValueError(f"{path}: empty translation for {source!r}")
		if source != source.strip() or translation != translation.strip():
			raise ValueError(f"{path}: surrounding whitespace is not portable to native Frappe: {source!r}")
		if placeholders(source) != placeholders(translation):
			raise ValueError(f"{path}: placeholder mismatch for {source!r}")
	return catalogue


def native_csv(catalogue):
	stream = io.StringIO(newline="")
	writer = csv.writer(stream, lineterminator="\n")
	for source, translation in sorted(catalogue.items()):
		# Frappe supports a key:context lookup in its native translation map too.
		writer.writerow((source.replace("\n", "\\n"), translation.replace("\n", "\\n")))
	return stream.getvalue()


def sync_catalogue(path, *, write=False):
	path = Path(path)
	catalogue = load_catalogue(path)
	expected = native_csv(catalogue)
	destination = path.with_suffix(".csv")
	if write:
		destination.write_text(expected, encoding="utf-8", newline="")
	elif not destination.exists() or destination.read_text(encoding="utf-8") != expected:
		raise ValueError(f"{destination}: missing or stale; regenerate with --write")
	return len(catalogue)


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	mode = parser.add_mutually_exclusive_group(required=True)
	mode.add_argument("--write", action="store_true")
	mode.add_argument("--check", action="store_true")
	parser.add_argument("catalogues", nargs="+", type=Path, help="Explicit translation JSON files")
	args = parser.parse_args()
	failed = False
	for path in args.catalogues:
		try:
			count = sync_catalogue(path, write=args.write)
			print(
				f"{path}: {count} translations validated; native CSV {'written' if args.write else 'current'}"
			)
		except (ValueError, OSError) as error:
			failed = True
			print(error)
	return int(failed)


if __name__ == "__main__":
	raise SystemExit(main())
