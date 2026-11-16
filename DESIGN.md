---
version: alpha
name: 祈 (Inorinal)
description: Design contract for the 祈 / Inorinal React Native journal app — near-black glass canvas, editorial type, and category-coded accents. Dark is the default presentation.
colors:
  background: "#050507"
  surface: "#121216"
  elevated: "#1C1C22"
  foreground: "#F5F5F7"
  foreground-muted: "#A1A1AA"
  separator: "rgba(255, 255, 255, 0.12)"
  glass: "rgba(18, 18, 23, 0.72)"
  primary: "#FF2D55"
  accent-blue: "#0A84FF"
  accent-cyan: "#32D7FF"
  accent-lime: "#C6FF3D"
  accent-yellow: "#FFD60A"
  accent-green: "#28CD41"
typography:
  display:
    fontSize: 34px
    lineHeight: 38px
    fontWeight: 700
    letterSpacing: -0.5px
  title:
    fontSize: 26px
    lineHeight: 30px
    fontWeight: 700
    letterSpacing: -0.3px
  section:
    fontSize: 20px
    lineHeight: 24px
    fontWeight: 700
    letterSpacing: -0.2px
  body:
    fontSize: 15px
    lineHeight: 20px
    fontWeight: 400
  caption:
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 500
  nav:
    fontSize: 11px
    lineHeight: 14px
    fontWeight: 600
rounded:
  sm: 8px
  md: 12px
  lg: 18px
  xl: 28px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 32px
  4xl: 40px
  section-gap: 28px
---

## Overview

祈 (Inorinal) is a quiet, local-first Android journal. Entries are written, doodled, and kept on the device; the interface exists to get out of the way of that. The visual direction is a near-black glass canvas with editorial typography, a single saturated brand accent, and color that comes from the user's own entries and stickers rather than from decorative gradients.

Dark is the default presentation, not an alternate skin. Light mirrors the same geometry and hierarchy with inverted neutrals. Depth comes from translucent glass and hairline separators, never from drop shadows.

## Colors

The neutral stack is the interface; accents are content coding, not decoration.

- `{colors.background}` is the page canvas. `{colors.surface}` is the resting card and list surface, and `{colors.elevated}` is the next step up for sheets, menus, and raised cards. Never skip a step to fake depth.
- `{colors.foreground}` is body and title ink. `{colors.foreground-muted}` is metadata, timestamps, and secondary labels. Do not use muted ink for primary actions.
- `{colors.separator}` draws every hairline: list dividers, card outlines, and input borders. Do not draw a border with an opaque gray.
- `{colors.glass}` is a floating-chrome fill only: navigation bars, the floating action surface, and sheets over scrolling content.
- `{colors.primary}` is the product accent for primary actions, selected states, and favorite markers. The `accent-*` tokens code entry categories; they must never carry actions, errors, or navigation selection.

## Themes

Frontmatter carries the dark presentation. The approved light equivalents are:

| Token | Dark (default) | Light |
| --- | --- | --- |
| `{colors.background}` | `#050507` | `#F5F5F7` |
| `{colors.surface}` | `#121216` | `#FFFFFF` |
| `{colors.elevated}` | `#1C1C22` | `#FFFFFF` |
| `{colors.foreground}` | `#F5F5F7` | `#111114` |
| `{colors.foreground-muted}` | `#A1A1AA` | `#6E6E73` |
| `{colors.separator}` | `rgba(255, 255, 255, 0.12)` | `rgba(0, 0, 0, 0.08)` |
| `{colors.glass}` | `rgba(18, 18, 23, 0.66)` | `rgba(255, 255, 255, 0.72)` |
| `{colors.primary}` | `#FF2D55` | `#FA2D48` |
| `{colors.accent-blue}` | `#0A84FF` | `#007AFF` |
| `{colors.accent-cyan}` | `#32D7FF` | `#00B8D9` |
| `{colors.accent-lime}` | `#C6FF3D` | `#65C400` |
| `{colors.accent-yellow}` | `#FFD60A` | `#F5C200` |
| `{colors.accent-green}` | `#28CD41` | `#1DB954` |

In light mode `{colors.elevated}` resolves to the same white as `{colors.surface}`; separate elevation there with `{colors.separator}` hairlines rather than a darker fill.

## Typography

Type is the platform system sans. The scale is editorial: large titles are heavy and tightly tracked, body copy is quiet, and metadata is small enough to recede.

- `{typography.display}` is the app-level or screen-level title, used once at the top of a screen.
- `{typography.title}` heads a sheet or a major content block. `{typography.section}` heads a list group inside a screen.
- `{typography.body}` is all entry text and card body copy; do not shrink it to fit — reduce copy instead.
- `{typography.caption}` carries timestamps, counts, and supporting metadata. `{typography.nav}` is tab labels and the smallest persistent chrome.
- Negative tracking belongs only to `{typography.display}`, `{typography.title}`, and `{typography.section}`. Body, caption, and nav keep default tracking.

## Layout

The layout is a single column of blocks with a fixed gutter and a consistent gap between sections. Everything that reads as a group — a card, its metadata, and its actions — shares one padding step, and the page gutter is a token, not a per-screen number.

- `{spacing.lg}` is the page gutter on regular widths and steps down to `{spacing.md}` on narrow phones.
- `{spacing.section-gap}` separates sections; do not reproduce it inside a section.
- The scale is 4-based. Compose padding from scale steps instead of half steps, and keep vertical padding inside a card smaller than its horizontal padding budget so rows stay compact.

## Elevation & Depth

Depth is glass and hairlines. There are no drop shadows in the interface.

- Floating chrome uses `{colors.glass}` plus a blur; content cards use `{colors.surface}` or `{colors.elevated}` and never blur.
- A raised element must sit on the next neutral step, or on glass if it floats over scrolling content — not on both.
- Outline raised surfaces with `{colors.separator}` so they stay legible on the near-black canvas without shadows.

## Shapes

Radii map to element scale: small controls take the small step, cards the middle step, sheets and hero blocks the large steps, and anything pill-shaped or circular takes the full radius.

- `{rounded.sm}` for chips, inputs, and small buttons. `{rounded.md}` for cards and list containers.
- `{rounded.lg}` for sheets and dialogs, `{rounded.xl}` for full-bleed hero or sticker blocks.
- `{rounded.full}` for pills, the floating action button, and avatar masks. Do not mix a pill radius into a card.
