---
version: alpha
name: Apple Music CN 新发现 (Reconstructed)
description: Reconstructed visual system for the Apple Music CN 新发现 template, measured from rendered desktop and mobile pages in dark and light color schemes.
colors:
  canvas: "#1f1f1f"
  surface: "#ffffff0d"
  glass: "#26262899"
  foreground: "#ffffffeb"
  foreground-muted: "#ffffffa3"
  foreground-subtle: "#ffffff66"
  primary: "#0a84ff"
typography:
  display:
    fontFamily: SF Pro
    fontSize: 34px
    lineHeight: 40px
    fontWeight: 700
  title-emphasized:
    fontFamily: SF Pro
    fontSize: 17px
    lineHeight: 22px
    fontWeight: 700
  title:
    fontFamily: SF Pro
    fontSize: 17px
    lineHeight: 22px
    fontWeight: 400
  body:
    fontFamily: SF Pro
    fontSize: 15px
    lineHeight: 20px
    fontWeight: 400
  nav:
    fontFamily: SF Pro
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 400
  meta:
    fontFamily: SF Pro
    fontSize: 13px
    lineHeight: 16px
    fontWeight: 400
  caption:
    fontFamily: SF Pro
    fontSize: 12px
    lineHeight: 15px
    fontWeight: 400
  eyebrow:
    fontFamily: SF Pro
    fontSize: 11px
    lineHeight: 14px
    fontWeight: 600
  action:
    fontFamily: SF Pro
    fontSize: 13px
    lineHeight: 16px
    fontWeight: 600
rounded:
  cta: 3px
  artwork-small: 5px
  control-compact: 6px
  artwork: 7px
  control: 8px
  card-artwork: 10px
  pill: 1000px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 20px
  xl: 24px
  2xl: 32px
  3xl: 40px
  gutter-narrow: 25px
components:
  page-shell:
    backgroundColor: "{colors.canvas}"
    typography: "{typography.body}"
    padding: "{spacing.3xl}"
  navigation-sidebar:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.control}"
    padding: "{spacing.xs}"
    typography: "{typography.nav}"
  glass-player:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.pill}"
    padding: "{spacing.md}"
    height: "56px"
  sign-in-pill:
    backgroundColor: "#ffffff"
    textColor: "#000000"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "{spacing.md}"
    typography: "{typography.nav}"
  accent-cta:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.cta}"
    typography: "{typography.action}"
  track-row:
    typography: "{typography.meta}"
    textColor: "{colors.foreground}"
---

## Overview

This is a **reconstructed draft**: a role-based reading of the Apple Music CN 新发现 (New) template, derived from rendered pages rather than from Apple's source or internal naming. Apple Music presents music discovery as an editorial publication: a near-black canvas, dense typographic shelves of album and playlist art, and floating chrome that stays visually quiet while artwork carries the color.

The direction is dark first. Light presentation swaps the canvas and ink but keeps the same geometry, the same glass treatment on floating chrome, and the same restrained accent usage.

## Colors

Canvas carries the page; artwork carries the color. Keep large surfaces neutral so album art remains the only saturated element in view.

- `{colors.canvas}` fills the page background at every scroll depth.
- `{colors.surface}` is a barely-there fill for grouped content blocks; it must stay subordinate to artwork.
- `{colors.foreground}` is the default text and icon ink. `{colors.foreground-muted}` carries secondary metadata such as artist and curator lines, and `{colors.foreground-subtle}` is reserved for the least important annotations.
- `{colors.primary}` marks the single primary commerce action on the page. Do not use it for links, labels, or selection states.
- `{colors.glass}` is a translucent chrome fill only; it never sits behind content rows.

## Themes

Frontmatter carries the dark presentation. The measured light presentation is:

| Token | Dark (default) | Light |
| --- | --- | --- |
| `{colors.canvas}` | `#1f1f1f` | `#ffffff` |
| `{colors.surface}` | `#ffffff0d` | `#0000000d` |
| `{colors.glass}` | `#26262899` | `#f5f5f78c` |
| `{colors.foreground}` | `#ffffffeb` | `#000000e0` |
| `{colors.foreground-muted}` | `#ffffffa3` | `#0000008f` |
| `{colors.foreground-subtle}` | `#ffffff66` | `#0000007a` |
| `{colors.primary}` | `#0a84ff` | `#007aff` |

## Typography

Type is set in SF Pro, served as the SF Pro web font with the system sans stack as fallback. The scale is tight and editorial: display type is bold and compact, metadata is small and quiet, and no role uses uppercase or added tracking.

- `{typography.display}` is the page title of a template, set once per page above the first shelf.
- `{typography.title-emphasized}` heads a shelf; `{typography.title}` is the same size at regular weight for editorial card titles beneath artwork.
- `{typography.body}` carries readable single-line titles where the row provides more width, such as wide lockups.
- `{typography.nav}` is the sidebar item and pill-label size; selected sidebar items keep the size and increase weight.
- `{typography.meta}` is the workhorse for track titles, table cells, and buttons. `{typography.caption}` drops one step for the second line of a lockup. `{typography.eyebrow}` labels a card above its title.
- `{typography.action}` labels compact commerce buttons; do not use it for body copy.

## Layout

The page is a fixed sidebar plus a single scrolling editorial column. The column is inset from the viewport by the page gutter, and every shelf aligns to that same inset so artwork edges form one vertical line down the page.

Shelves stack with a consistent block gap and never overlap: title, artwork row, then the next shelf. Horizontal shelves scroll within their own row rather than wrapping. On narrow viewports the sidebar leaves the layout and becomes a horizontal top bar; the column keeps the same inset logic with the narrow gutter and one less visible column of artwork.

Keep the gutter as a layout token, not a per-component padding: a shelf, its heading, and its trailing link must share one inset.

## Elevation & Depth

Depth is expressed as translucent chrome, not as shadow. Floating chrome (the navigation sidebar, the player bar, the circular play control) uses a backdrop filter with strong saturation and blur so artwork behind it stays legible as color while the chrome stays unreadable as content. Content surfaces themselves stay flat.

- Glass belongs only to chrome that floats over scrolling artwork. Never put a backdrop filter on a content card, a row, or text block.
- The player bar and other floating pills add a hairline inner stroke to define their edge against busy artwork.
- Hover and selected states on chrome and artwork are a low-opacity overlay fill, not a shadow or a border.

## Shapes

Radii scale with element size and function. Artwork uses small radii so images read as printed covers rather than app cards; interactive controls use a slightly larger radius; pills and the player bar are fully rounded.

- Artwork corners are small and consistent across a row so a shelf reads as one band.
- The play control over artwork is circular.
- Buttons in the inline commerce banner keep a small radius, deliberately different from the rounded sign-in pill.

## Components

**Navigation sidebar.** Glass fill with backdrop blur, an inset item radius, and compact item padding. The selected item adds a translucent fill and a heavier label weight; it does not change color.

**Glass player.** A pill-shaped floating bar: glass fill, backdrop blur, inner stroke, fixed height, and a centered maximum width so it never spans a wide desktop viewport.

**Sign-in pill.** Fully rounded, inverted against the canvas (light fill on dark, dark fill on light), fixed height, and label type at the nav size.

**Accent CTA.** Solid accent fill with foreground ink and a small radius. It is the only saturated button in the interface and appears once per page, inside the inline commerce banner.

**Track row.** Two lines of type: a title at meta size and a secondary line at caption size in the muted ink. Rows align in a grid with artists and albums in their own columns and a trailing overflow control.
