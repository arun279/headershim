# Brand mark

HeaderShim ships one brand mark at a time. This directory holds every candidate mark as production-ready source, so switching the brand is a copy and a regenerate, never a redraw.

## Active mark

Split Register is the active mark: one circle cleaved into two half-discs on different datums, brought into a precise relationship by a thin teal shim seated in the channel. Its light lockup is the current `assets/logo.svg` and its 16px form is the current `assets/logo-16.svg`. The in-app wordmark in `entrypoints/options/Wordmark.tsx` inlines the same offset-disc-and-shim glyph at favicon size, colored from the theme tokens, so the name and its mark stay in step with the toolbar icon.

Colon is the alternate: two paper squares form the `key: value` colon and a single teal bar is set beside it as the shim.

## Files

Each mark ships three sources.

The plain file is the light lockup on a paper tile (paper tile, ink disc, teal accent) that feeds the 48px and 128px icons. The `-dark` file is the dark lockup (ink tile, paper disc, brighter teal) for an icon set that bakes dark by default. The `-16` file is the favicon form on an ink tile, tuned to read at 16px on both light and dark browser chrome, that feeds the 16px and 32px icons.

- `split-register.svg`, `split-register-dark.svg`, `split-register-16.svg`: the active mark, the offset split disc.
- `colon.svg`, `colon-dark.svg`, `colon-16.svg`: the alternate mark, the key-and-value colon.

The palette is fixed across every mark: paper `#fcfcfb`, ink `#191a1d`, and one teal accent, `#0c8a63` on paper or `#37cf99` on ink. The accent only ever marks the shim, and every mark survives in pure monochrome with the accent removed.

## Switching the active mark

`scripts/render-icons.mjs` rasterizes `assets/logo.svg` to the 48px and 128px icons and `assets/logo-16.svg` to the 16px and 32px icons. To make a different mark active, copy its light lockup over `assets/logo.svg` and its 16px form over `assets/logo-16.svg`, regenerate the PNGs, and commit the result. To switch to Colon, from the repository root:

```sh
cp design/logo/colon.svg assets/logo.svg
cp design/logo/colon-16.svg assets/logo-16.svg
pnpm icons
git add assets/logo.svg assets/logo-16.svg public/icon
git commit
```

`pnpm run check:icons` compares the committed PNGs against the source SVGs, so a swap that forgets `pnpm icons` fails in CI.

The wordmark glyph in `entrypoints/options/Wordmark.tsx` carries an inline reduction of the active mark. A full brand switch also updates that glyph to the new mark's geometry so the in-app name and the icon show the same brand.
