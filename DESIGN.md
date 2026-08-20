---
version: alpha
name: ColorMaster
description: Offline color-memory game built around an interactive cyan-and-orange geometric cube identity.
omitted:
  - section: spacing
    reason: The current product has no named shared spacing scale; responsive and fit-specific values remain source-owned.
  - section: rounded
    reason: The current product has a recurring radius hierarchy but no named shared radius tokens.
colors:
  primary: "#5ec8c2"
  ink-950: "#041116"
  ink-900: "#071820"
  ink-800: "#0d252d"
  line: "#27454d"
  line-soft: "rgba(119, 202, 198, 0.13)"
  cyan: "#5ec8c2"
  cyan-bright: "#7bd9d3"
  cyan-soft: "rgba(94, 200, 194, 0.12)"
  coral: "#f36f63"
  coral-bright: "#ff8b7d"
  coral-soft: "rgba(243, 111, 99, 0.12)"
  cream: "#f4efe6"
  muted: "#a8b8ba"
  subtle: "#879b9e"
typography:
  body:
    fontFamily: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  technical:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
---

## Overview

ColorMaster is a Chinese-first browser game for observing, remembering, and reproducing color. Its identity is the split-color geometric cube: cyan and warm orange express the two halves of “忆色,” while a quiet neutral stage keeps gameplay colors visually dominant.

## Colors

Use `ink-950`, `ink-900`, and `ink-800` for the original dark stage and control surfaces. Use `line` for strong control edges and `line-soft` for quiet structure inside panels.

In the default theme, use `cyan` as the primary in-game action and progress signal, `cyan-bright` for selected or hovered emphasis, and `cyan-soft` for low-emphasis interactive surfaces. Other themes map those roles to their own primary accent. Progress fills use the active primary accent, while their low-contrast tracks use the theme-specific `progress-track` token rather than a shared gray or cyan surface.

In the default theme, reserve `coral` for the second brand glyph, the landing-page challenge action, destructive archive confirmation, and negative or unavailable states. Other themes map those roles to their own secondary accent.

Use `cream` for primary content, `muted` for supporting copy, and `subtle` for metadata. Runtime HSL, RGB, target, preview, result, and archive swatch colors are game data rather than interface palette tokens.

The interface has three deliberate themes: cyan/orange (`#5ec8c2`, `#f36f63`), starry violet/lemon (`#8f79e8`, `#ece165`) on an indigo-black stage (`#100b25` to `#06040d`), and mist-blue/soft-pink (`#99b7e8`, `#f3a1b0`) on a deep slate stage (`#151b2c` to `#090d17`). Theme changes affect interface chrome and brand surfaces only. Keep a fixed neutral surround around target and answer swatches so theme selection does not change local color perception.

## Typography

Use the local Chinese system stack declared on the application body for interface copy and headings. Do not introduce a remote font dependency.

Use the local monospace stack for English technical labels, color codes, formulas, countdowns, capacities, scores, and other tabular data. Keep tabular figures enabled wherever values update in place.

The landing title is the only oversized split-color display treatment. Screen headings remain cream and heavy; technical eyebrows remain compact, widely tracked, and secondary to the Chinese heading.

## Layout

On desktop, keep the application as a full-height vertical stage. Center the active short screen within the available main area and keep the static copyright footer on one stable bottom baseline. When content exceeds the viewport, allow the document to grow and place the footer after the content.

On mobile, use natural block flow rather than desktop vertical centering. Respect all safe-area insets, keep primary actions full-width where established, and preserve first-screen access to the recall submission action at the default text size.

Keep the main content constrained on wide screens. Mode selection uses two columns on desktop, difficulty selection uses three, and both collapse to one column on mobile. Preserve the compact short-landscape layouts for the landing and matching screens.

Treat the recall statistics, active controls, and result as one continuous workbench. Nested recall sections must not add competing panel borders, shadows, or radii inside that shell.

## Elevation & Depth

Use `--shadow-panel` only for major screens and the continuous recall shell. Use `--shadow-card` for cards, statistics, and hover elevation. Inner control groups use quiet tinted fills and `line-soft` rather than another large shadow.

Low-contrast grids and restrained ambient color support the geometric identity but must remain visually subordinate to the cube, target colors, and controls. Large surfaces should use mostly opaque color rather than stacking heavy blur effects.

The landing cube sits inside a three-axis color-calibration field: three concentric diamonds establish depth, while broken primary, secondary, and structural rails echo the cube's isometric axes. Keep the lines interrupted around the cube so they frame the object instead of crossing its faces.

## Shapes

Maintain a clear radius hierarchy: the landing stage is softest, major screens are one step tighter, cards and control groups tighter again, and compact controls use the smallest corners. Reserve circles and full pills for indicators, badges, slider tracks, and genuinely circular controls.

Keep gameplay and archive colors as square swatches. The archive may retain its folded-corner sample detail and active-theme selected ring because those treatments distinguish stored samples from live game controls.

## Components

Primary in-game actions use the active theme’s primary accent with a tested on-accent text color. The landing challenge action uses the active secondary accent. Secondary and restart actions use a quiet outline over the current surface.

Back and exit controls stay visually compact while retaining an expanded touch target. They remain secondary to the screen title and primary task.

Mode and difficulty cards use theme-tinted surfaces, thin structural borders, technical labels, and restrained elevation. Their hover and keyboard-focus treatments must communicate the same interactive state.

Statistics use compact bordered cells and monospace values. Do not add decorative charts or extra metrics that compete with the current round, score, best record, or lives. When difficulty-level best records are shown, keep the adjacent note that identifies them as device-local cache and names the two common reset conditions: clearing cache and changing devices.

Recall results pair the short motivational message with one plain-language diagnostic. Describe differences only as hue, saturation, and lightness; keep Oklab chroma and low-level scoring terminology inside implementation and optional scoring details.

## Motion

Use motion only for feedback, state legibility, spatial continuity, or rare completion delight. Prefer transform and opacity, preserve the existing reduced-motion path, and avoid animating the page shell or footer between screens.

Keep the countdown progress linear and time-accurate. Do not apply decorative easing to elapsed-time indicators.

The landing cube is the signature interaction. On activation, rotate the real CSS 3D cube 120 degrees around its body diagonal, swap the theme at the midpoint, and settle within 520ms. Use only transform and opacity for spatial motion; under reduced motion, switch themes without rotation.

At every settled theme angle, preserve the cube's face logic from the original mark: the top is a mixed, light-catching arrangement of neutral, primary, and secondary tiles; the screen-left face descends through the primary cool family; the screen-right face descends through the secondary warm family. Map physical faces per rotation rather than allowing a monochrome side to become the top face.

Gate hover-only movement to devices that actually support hover. Touch interaction must not inherit false hover lifts.

## Do's and Don'ts

Do preserve the cube mark, three intentional palettes, Chinese-first hierarchy, technical data language, desktop/mobile behavior, safe areas, keyboard access, focus management, and offline fallbacks.

Do verify visual changes at desktop, common phone widths, narrow screens, short landscape, and enlarged text before shipping.

Don't add CDN resources, remote fonts, external images, network APIs, runtime packages, a new framework, or another animation system.

Don't use fixed or absolute positioning for the copyright footer, and don't allow it to cover game content.

Don't promote unused CSS variables, stale Tailwind utility intent, candidate artwork, functional color spectra, or one-off warning colors into the shared design system.
