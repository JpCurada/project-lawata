"""Vendor Arc components (https://uiarc.dev, free shadcn-style registry) into web/src/shared/ui/arc/.

Usage (from web/):
    uv run --project ../api python -I scripts/arc_add.py text-shimmer image-compare
    python scripts/arc_add.py theme-switch

Fetches each item from https://uiarc.dev/r/{name}.json plus its registryDependencies (recursively) and writes
every file under src/shared/ui/arc/, keeping Arc's layout below the `@components/arc/` target. File contents stay
byte-identical to the registry except that alias imports (`@components/arc/...`) are rewritten to relative paths
and the few fixes in PATCHES are re-applied, so re-running the script updates vendored files cleanly. Prints the
union of npm dependencies to install.

`arc-foundation` (foundation.css) is always skipped: it redefines Lawata tokens with other values and adds global
focus rules. Arc's tokens are mapped onto Lawata's in src/shared/styles/arc-bridge.css instead.
Stdlib only.
"""

from __future__ import annotations

import json
import posixpath
import re
import sys
import urllib.request
from pathlib import Path, PurePosixPath

REGISTRY = "https://uiarc.dev/r/"
SKIPPED = {"arc-foundation": "redefines Lawata tokens and global focus rules; see styles/arc-bridge.css"}
TARGET_PREFIXES = ("@components/arc/", "@/components/arc/")
OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "shared" / "ui" / "arc"
# Smallest local fixes, re-applied on every run: (file, exact text, replacement, reason). Keep this list short.
PATCHES: list[tuple[str, str, str, str]] = [
    (
        "button/button.tsx",
        "function LabelPhase({ children, icon, reduced, ref }: { children: ReactNode; icon: boolean; reduced: boolean;"
        " ref?: Ref<HTMLSpanElement> }) {\n",
        "const LabelPhase = forwardRef<HTMLSpanElement, { children: ReactNode; icon: boolean; reduced: boolean }>("
        "function LabelPhase({ children, icon, reduced }, ref) {\n",
        "React 18 does not pass `ref` as a prop; AnimatePresence popLayout needs the ref, so use forwardRef",
    ),
    (
        "button/button.tsx",
        "</motion.span>;\n}\n\nexport const Button",
        "</motion.span>;\n});\n\nexport const Button",
        "closes the forwardRef above",
    ),
]
# Matches the module specifier in `from "x"`, `import "x"` and `import("x")`.
IMPORT_RE = re.compile(r"""(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']+)\2""")


def item_name(ref: str) -> str:
    """Registry dependencies are URLs or bare names; both reduce to the item name."""
    return PurePosixPath(ref.rstrip("/")).name.removesuffix(".json")


def fetch(name: str) -> dict:
    request = urllib.request.Request(f"{REGISTRY}{name}.json", headers={"User-Agent": "lawata-arc-add"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def relative_target(target: str) -> str:
    for prefix in TARGET_PREFIXES:
        if target.startswith(prefix):
            rel = target[len(prefix) :]
            break
    else:
        raise ValueError(f"unexpected target {target!r}")
    clean = posixpath.normpath(rel)
    if clean.startswith("..") or posixpath.isabs(clean):
        raise ValueError(f"target escapes the arc folder: {target!r}")
    return clean


def rewrite_imports(content: str, file_rel: str) -> tuple[str, list[str]]:
    """Turns alias imports into paths relative to the file; returns the new text and any aliases left unresolved."""
    leftovers: list[str] = []
    here = posixpath.dirname(file_rel)

    def replace(match: re.Match[str]) -> str:
        lead, quote, spec = match.groups()
        for prefix in TARGET_PREFIXES:
            if spec.startswith(prefix):
                rel = posixpath.relpath(spec[len(prefix) :], here or ".")
                rel = rel if rel.startswith(".") else f"./{rel}"
                return f"{lead}{quote}{rel}{quote}"
        if spec.startswith(("@/", "~/", "@components/", "@lib/")):
            leftovers.append(spec)
        return match.group(0)

    return IMPORT_RE.sub(replace, content), leftovers


def collect(names: list[str]) -> list[dict]:
    seen: set[str] = set()
    items: list[dict] = []
    queue = list(names)
    while queue:
        name = item_name(queue.pop(0))
        if name in seen:
            continue
        seen.add(name)
        if name in SKIPPED:
            print(f"skip {name}: {SKIPPED[name]}")
            continue
        item = fetch(name)
        items.append(item)
        queue.extend(item.get("registryDependencies") or [])
    return items


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    items = collect(argv)
    npm: set[str] = set()
    problems = 0
    for item in items:
        npm.update(item.get("dependencies") or [])
        for file in item.get("files") or []:
            rel = relative_target(file.get("target") or file["path"])
            content, leftovers = rewrite_imports(file["content"], rel)
            for target, old, new, reason in PATCHES:
                if target != rel:
                    continue
                if old in content:
                    content = content.replace(old, new, 1)
                    print(f"  patched {rel}: {reason}")
                elif new not in content:
                    problems += 1
                    print(f"  warning: patch no longer applies to {rel} ({reason}); check upstream")
            dest = OUT_DIR / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("w", encoding="utf-8", newline="") as handle:
                handle.write(content)
            print(f"wrote {dest.relative_to(OUT_DIR.parent.parent.parent.parent).as_posix()}  ({item['name']})")
            for spec in leftovers:
                problems += 1
                print(f"  warning: unresolved alias import {spec!r}")
    print("\nnpm dependencies (install with: npm install --save-exact <pkgs>):")
    print("  " + (" ".join(sorted(npm)) or "(none)"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
