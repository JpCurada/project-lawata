# Arc components (vendored)

Source: [Arc](https://uiarc.dev), free registry at `https://uiarc.dev/r/{name}.json`. React + CSS modules, animated with `motion`; icons from `lucide-react`.

- Add or update items from `web/`: `uv run --project ../api python -I scripts/arc_add.py <names...>` (or plain `python scripts/arc_add.py ...`). It pulls registry dependencies too, rewrites `@components/arc/...` imports to relative paths, re-applies the small fixes listed in `PATCHES`, and prints the npm packages to install with `npm install --save-exact`.
- Do not hand-edit files here; re-running the script overwrites them. Put local fixes in the script's `PATCHES` list, and style changes in your own CSS (pass `className`).
- `arc-foundation` (foundation.css) is never vendored. Arc's token names are mapped onto Lawata tokens in `src/shared/styles/arc-bridge.css` (loaded right after `tokens.css` in `main.tsx`), so components follow Lawata's palette and both themes.
- Vendored now: text-shimmer, image-compare, segmented-control, search-field, theme-switch, plus button and motion-tokens as dependencies.
