# Apple Music CN 新发现 — extraction notes

Companion notes for `docs/design-references/apple-music-cn-new.DESIGN.md`. This file records method,
raw evidence, omissions, and limitations. It is intentionally **not** part of DESIGN.md: DESIGN.md is
a normative token + guidance document, this is the audit trail behind it.

## 1. Mode and scope

- Skill: `create-design-md`, **URL mode** (no Apple source repository).
- Target: `https://music.apple.com/cn/new` (Apple Music 新发现), plus one template each from the same
  origin for recurrence: `/cn/home` and one live room page.
- Output: a **reconstructed draft**. URL evidence can only establish observable visual patterns and
  computed values; it cannot establish Apple's internal token names, component ownership, or intent.

## 2. Method (rendered browser evidence)

- Browser: Microsoft Edge `Edg/157.0.4341.46`, headless, remote debugging on `127.0.0.1:9222`,
  profile `%TEMP%\inorinal-design-edge`.
- Collector: `scripts/design-extract.mjs` (Node 24, built-in `fetch` + `WebSocket`, no puppeteer).
  Two modes: default sampling pass and `--probe` census pass.
- Sampling pass, per page × viewport × color scheme:
  1. `Emulation.setDeviceMetricsOverride` + `Emulation.setEmulatedMedia({prefers-color-scheme})`.
  2. `Page.navigate`, wait for `document.readyState === "complete"` and a stable `innerText` length,
     plus a settle delay for the webfont and lazy hero media.
  3. Injected sampler: indexes every readable rule in `document.styleSheets` (recursing into `@media`,
     `@supports`, `@layer`), then for each sampled element records the reconstructed role, bounding
     box, computed values, and — for the properties that matter — the **matching loaded CSS
     declaration** (selector + declaration text + stylesheet href + media condition).
  4. Dumps `:root` custom properties that hold colors, filters, dimensions, and font stacks.
  5. `Page.captureScreenshot` to `%TEMP%\inorinal-design-evidence\screens\` (never into the repo).
- Census pass (`--probe`): whole-DOM typography / color / radius / padding / gap / shadow / glass
  census with usage counts, plus a literal search of loaded CSS for candidate values.
- Confirmation pass: CDP `CSS.getMatchedStylesForNode` for `h1`, `.chrome-player`, `.commerce-button`,
  `.navigation-item--selected`, and the shelf container, to confirm the declaration behind a computed
  value where the heuristic matcher missed a shorthand (`font: var(--header-emphasized)`).
- Raw evidence (kept out of the repo):
  `%TEMP%\inorinal-design-evidence\{ledger.json,aggregate.json,probe.json,screens\*.png}`.

## 3. Samples

| # | URL | Viewport | Schemes |
| --- | --- | --- | --- |
| 1 | `https://music.apple.com/cn/new` | 1440×1024 | dark, light |
| 2 | `https://music.apple.com/cn/new` | 390×844 | dark, light |
| 3 | `https://music.apple.com/cn/home` | 1440×1024 | dark, light |
| 4 | `https://music.apple.com/cn/home` | 390×844 | dark, light |
| 5 | `https://music.apple.com/cn/room/6834183219` (discovered from `/cn/new` links) | 1440×1024 | dark, light |
| 6 | `https://music.apple.com/cn/room/6834183219` | 390×844 | dark, light |

12 samples total. Loaded rule counts indexed per sample: 6,297–6,864 rules; ~535–549 custom properties
resolved on `:root`.

## 4. Evidence that survived the gate

Each promoted value below met the skill's gate: computed value **and** a loaded declaration/custom
property agree, or the same computed value recurs for the same role across the sampled templates.

| Role | Computed | Declaration / custom property |
| --- | --- | --- |
| Page background (dark) | `rgb(31, 31, 31)` on `body` | `body { background-color: var(--pageBG) }`, `--pageBG: #1f1f1f` |
| Page background (light) | `rgb(255, 255, 255)` | `--pageBG-light: #fff` |
| Primary ink (dark / light) | `rgba(255,255,255,.92)` / `rgba(0,0,0,.88)` | `--systemPrimary: #ffffffeb` / `#000000e0`, used as `color: var(--systemPrimary)` |
| Muted ink | `rgba(255,255,255,.64)` / `rgba(0,0,0,.56)` | `--systemSecondary: #ffffffa3` / `#0000008f` |
| Subtle ink | `rgba(255,255,255,.4)` / `rgba(0,0,0,.48)` | `--systemTertiary: #fff6` / `#0000007a` |
| Sheen fill | `rgba(255,255,255,.05)` / `rgba(0,0,0,.05)` | `--shelfBG: #ffffff0d` / `#0000000d` (= `--systemQuinary`) |
| Glass chrome fill | `rgba(38,38,40,.6)` / `rgba(245,245,247,.55)` | `--glassMaterialBackground: #26262899` / `#f5f5f78c` |
| Accent CTA | `rgb(10,132,255)` dark, `rgb(0,122,255)` light | no single declaration matched; promoted by recurrence (same role on `/cn/new` and the room page) |
| Page title | 34px / 40px / 700 | `.header-nav__heading { font: var(--header-emphasized) }`, `--header-emphasized: 700 34px/1.1764905882 …` |
| Shelf header | 17px / 22px / 700 | `--title-2-emphasized: 700 17px/1.2941176471`, rendered on 15 elements |
| Editorial card title | 17px / 22px / 400 | `.editorial-card__title` (rendered 8×) |
| Wide lockup title | 15px / 20px / 400 | `--title-3: 15px/1.3333833333`, rendered 16× |
| Sidebar item | 14px / 20px / 400, 600 selected | computed on `.navigation-item__label`, all three templates |
| Track / table / button text | 13px / 16px / 400 | `--body: 13px/1.2307692308`, rendered 299× |
| Card second line | 12px / 15px / 400 | `--callout: 12px/1.25`, rendered 213× |
| Eyebrow | 11px / 14px / 600 | `--subhead-emphasized: 600 11px/1.2727272727`, rendered 4× |
| Accent CTA label | 13px / 16px / 600 | computed on the upsell button (`/cn/new` + room page) |
| Nav item radius | 8px desktop, 6px under 484px | `.app-container .navigation-item { border-radius: 8px }`; `.navigation-item { border-radius: 6px }` |
| Player / sign-in radius | 1000px | `.chrome-player { border-radius: 1000px }`, `.signin { border-radius: 1000px }` |
| Newsletter CTA radius | 3px | computed on the upsell button |
| Artwork radii | 5px, 7px, 10px | computed on track / product / editorial artwork (129, 156, 26 elements) |
| Page gutter | 40px desktop, 25px mobile | `--bodyGutter: 40px` / `25px`, used as `margin-inline` on `.header-nav`; measured h1 x = 300 (260 sidebar + 40) and 25 on mobile |
| Shelf rhythm | 32px block padding | `.shelf { padding-top: 32px }`, `section.shelf-grid { padding: 0 var(--bodyGutter) }` |
| Grid / row gap steps | 24px, 20px, 8px, 4px | computed `gap` census on `/cn/new` (13× `24px 20px`, 9× `4px 20px`, 2× `8px`) |
| Card overlay padding | 24 / 16 / 16 / 16 | `.editorial-card__artwork-description { padding-top: 24px; padding: … 16px }` |
| Player geometry | 56px height, 668px max width, 16px inline padding | `.chrome-player { height: 56px; max-width: 668px; padding: 0 16px }` |
| Chrome backdrop | `saturate(220%) blur(16px)` | `.app-container .navigation { backdrop-filter: var(--glassMaterialBackdropFilter, saturate(220%) blur(16px)) }`, `.chrome-player::before` same |
| Platter backdrop | `saturate(180%) blur(60px)` | `.play-button--platter .icon { backdrop-filter: saturate(190%) blur(60px) }` with `@media (prefers-color-scheme: dark)` → 180%, light → 160% |
| Inner stroke | `#ffffff33` | `--glassMaterialInnerStrokeCombined: #fff3`, `box-shadow: inset .5px .5px …` on `.chrome-player::after` |
| Selected nav fill | `#ebebf51a` | `--navSidebarSelectedState: #ebebf51a` (light `#3c3c431a`) |

Recurrence counted across templates: sidebar, player bar, sign-in pill, upsell CTA, and track rows
appear on all three sampled templates; editorial shelves and card artwork were observed only on
`/cn/new`, so the derived guidance for them is scoped to that template in prose rather than presented
as site-wide.

## 5. Omitted values and why

- **Brand red `#fa2d48`** — a literal search of every readable loaded stylesheet (6.3k rules per
  sample) returned **no** declaration containing `fa2d48`, and the full computed-style census of 12
  samples returned **no** element using it. Reds that did appear (`rgb(215,85,121)`, `--systemRed
  #ff453a`, `--liveBadgePlatterBG #ff5066`) are artwork-derived or unrendered tokens. A declared but
  unapplied value cannot pass the three-proof gate, so the reference document's accent is the measured
  `#0a84ff`.
- **`#0d0d0d`, `#141414`, `#fafafa`, `#e6e6e6`** — present only as dark material / inner-stroke
  custom properties (`--glassMaterialInnerStrokeCombined`, `--systemStandard*MaterialSover`), not as
  rendered page, surface, or ink values. Page-level colors are `#1f1f1f`/`#fff` and
  `#ffffffeb`/`#000000e0`, so the material tokens were left out.
- **18px radius** — declared only as `--ctxmenu-trigger-border-radius: 18px` on the account menu,
  which cannot render without a signed-in Apple ID. Not observed, therefore omitted.
- **4px artwork and 12px room-tile radii** — measured (1 and 64 elements) but page-local detail; the
  reference keeps the radius set to roles that dominate a template or recur.
- **50% radius** on the circular play control — CSS percentages are not expressible in the schema's
  radius dimension, so circularity is stated in prose instead.
- **42px heading** — `font-size: 42px` exists only for `.faq-content-title` at `min-width: 1580px`
  on a page outside the sample; omitted.
- **Separator / divider color** — `--labelDivider: #ffffff1a` is declared, but the only computed
  border color captured on a rendered element was the light-mode `rgba(0,0,0,0.1)`; the dark hairline
  pair (computed + declaration on the same element) was not captured, so no separator token is
  claimed.
- **Fractional computed line-heights** — `40.0007px`, `20.0003px`, `17.2308px` are unitless-multiplier
  artefacts of the loaded CSS; the YAML records the whole-pixel values (40, 20, 17) those resolve to.
- **Light theme in frontmatter** — the installed spec (`@google/design.md` 0.4.0) has no `themes` /
  `default-theme` support, so the dark values are the canonical tokens and the light equivalents are
  documented in the `## Themes` table only.
- **Font family naming** — `font-family` computes to the `-apple-system, BlinkMacSystemFont, … "SF Pro"
  …` stack, but `document.fonts` confirms the SF Pro web font itself loaded and is used, so the token
  says `SF Pro` rather than the full fallback stack.

## 6. Limitations

- Headless Chromium/Edge rendering, not Safari on macOS: system-font fallback, scrollbars, and some
  platform materials differ from Apple's native rendering.
- No account was signed in. Account menus, Library, lyrics, and personalized shelves were never
  rendered, so any component that requires them is absent from the document.
- `/cn/home` is the **upsell/marketing** template (centered hero, app icon, trial CTA), not a content
  home, so it contributes chrome and marketing-type evidence only.
- Sampling happened at scroll position 0. Lazy-loaded shelves below the fold are represented only by
  what was mounted in the DOM at capture time; the census covers the mounted document, not the whole
  infinite feed.
- Hover, focus, active, and pressed states were not captured; the reference describes only resting and
  selected states.
- The upsell banner's copy and currency are region/account dependent (`¥12.00/月` here); no copy is
  reproduced in the reference.
- The measured commerce CTA pairs white ink on `#0a84ff` at 3.65:1, below WCAG AA for normal text.
  The reference records the measured pairing as evidence, not as a compliance claim; an Inorinal
  implementation should not copy it without fixing contrast.
- Screenshots exist only under `%TEMP%\inorinal-design-evidence\screens\`; none are committed to this
  repository.

## 7. Trademarks and assets

Apple, Apple Music, "新发现", SF Pro, and all album artwork are trademarks or copyrighted assets of
Apple Inc. This reconstruction reuses **no** Apple code, images, fonts, icons, or artwork: it records
measured layout and color roles in Inorinal's own token names, and the artwork visible in the capture
screenshots is not reproduced anywhere in the repo. Product names are used nominatively to describe
what was measured.

## 8. Validation

Tooling: `@google/design.md@0.4.0` (installed under a temp prefix; the bare
`npx @google/design.md …` form fails in this environment because the package's derived command name
contains a dot — `npx designmd …`, its second bin alias, runs the identical CLI).

```
$ npx designmd spec
# installed spec has no `themes` / `default-theme` field → dark tokens are canonical, light lives in ## Themes

$ npx designmd lint docs/design-references/apple-music-cn-new.DESIGN.md
errors 0, warnings 3, infos 1   (exit 0)
  - components.accent-cta: textColor #ffffffeb on backgroundColor #0a84ff = 3.65:1 (below WCAG AA 4.5:1)
  - colors.foreground-muted: defined but not referenced by a component
  - colors.foreground-subtle: defined but not referenced by a component

$ npx designmd export --format css-tailwind docs/design-references/apple-music-cn-new.DESIGN.md
exit 0 → --color-* ×7, --font-* ×9, --text-* ×9, --leading-* ×9, --font-weight-* ×9,
         --radius-* ×7, --spacing-* ×8
```

The three warnings are kept rather than papered over: the 3.65:1 contrast is the *measured* pairing
of Apple's commerce CTA (white ink on the accent blue), and the two unreferenced inks are real
measured roles (secondary ink is used outside components, tertiary ink appears on 4 elements) that no
recurring component sub-token can host. Export does not emit `components.*` — that is a limitation of
the `css-tailwind` target, not a missing token category.

The exported CSS is written to the temp evidence folder for inspection only and is **not** kept in the
repository. Raw evidence and screenshots stay in `%TEMP%\inorinal-design-evidence\` and are not part of
the repository.
