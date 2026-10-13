---
name: TrialSignal
description: Understand a medical study in plain English, and how sure we can be.
colors:
  bg: "#F5F8FC"
  surface: "#FFFFFF"
  soft: "#EEF3FA"
  ink: "#1F2B38"
  ink-2: "#4C5968"
  ink-3: "#5B6777"
  line: "#E3E9F1"
  line-2: "#EDF1F6"
  line-strong: "#C9D3DF"
  blue: "#2F5BD3"
  blue-2: "#2448AE"
  blue-wash: "#EAF0FD"
  proven: "#1C7A4E"
  proven-bg: "#E5F4EC"
  works: "#0F6E7C"
  works-bg: "#E2F3F5"
  promising: "#9A5800"
  promising-bg: "#FDF1DC"
  early: "#55657A"
  early-bg: "#EEF1F5"
  stopped: "#5B4E66"
  stopped-bg: "#F0EDF3"
typography:
  display:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2rem, 4.4vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.6rem, 3vw, 2.2rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  subtitle:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  answer:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.32rem"
    fontWeight: 500
    lineHeight: 1.5
  lead:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.6
  small:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Figtree, Segoe UI, system-ui, -apple-system, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 600
    lineHeight: 1.6
rounded:
  sm: "10px"
  tile: "12px"
  md: "16px"
  lg: "24px"
  pill: "999px"
spacing:
  chip-gap: "10px"
  card-gap: "16px"
  card-pad: "22px"
  answer-pad: "32px"
  gutter: "24px"
  gutter-mobile: "16px"
  section: "64px"
  section-mobile: "48px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.blue-2}"
    textColor: "{colors.surface}"
  button-soft:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue-2}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
    height: "48px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "12px 22px"
    height: "48px"
  button-ghost-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  nav-link:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
    height: "44px"
  nav-link-current:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue-2}"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 8px 8px 22px"
    width: "min(640px, 100%)"
  topic-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "9px 16px 9px 12px"
    height: "44px"
  topic-chip-selected:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue-2}"
  verdict-proven:
    backgroundColor: "{colors.proven-bg}"
    textColor: "{colors.proven}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 9px"
  verdict-works:
    backgroundColor: "{colors.works-bg}"
    textColor: "{colors.works}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 9px"
  verdict-promising:
    backgroundColor: "{colors.promising-bg}"
    textColor: "{colors.promising}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 9px"
  verdict-early:
    backgroundColor: "{colors.early-bg}"
    textColor: "{colors.early}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 9px"
  verdict-stopped:
    backgroundColor: "{colors.stopped-bg}"
    textColor: "{colors.stopped}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px 4px 9px"
  study-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.card-pad}"
  answer-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.answer}"
    rounded: "{rounded.lg}"
    padding: "{spacing.answer-pad}"
  ladder-rung:
    backgroundColor: "{colors.line-2}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.sm}"
    padding: "8px 6px"
  accordion-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "18px 22px"
  accordion-icon-tile:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.blue}"
    rounded: "{rounded.tile}"
    size: "36px"
  note:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "18px 22px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.caption}"
    rounded: "{rounded.tile}"
    padding: "12px 14px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "12px 18px"
---

# Design System: TrialSignal

## Overview

**Creative North Star: "The Plain-Language Leaflet"**

TrialSignal reads like a good patient leaflet set on a calm screen: an everyday question, a short plain answer, one label that says how sure we can be, and everything else folded away until asked for. The ground is an airy sky-white, content sits on soft white rounded surfaces, ink is a soft navy rather than black, and a single friendly blue marks what you can press. The only other colour on the page belongs to the verdict labels, so colour always carries meaning.

Density is deliberately low. One reading column, generous gaps between sections (64px), large body type (18px) and pill-shaped controls with 44 to 48px targets. Depth is soft and ambient: white surfaces lift off the ground with a faint navy-tinted shadow, never a hard edge. Figtree, a friendly geometric sans, does every job from the hero headline to the smallest caption, with weight rather than a second family carrying hierarchy.

This is a single light theme by deliberate choice. The user found the previous slate design too dark; there is no dark mode and none should be added without a new decision. The research-database look (tables of codes, phase jargon, dense grids) is the confirmed anti-reference: codes and key-value lists exist only inside the last "Study details for the curious" fold. The build extends the direction contract's four verdict labels with a fifth, plum "Didn't work or stopped", used in News.

**Key Characteristics:**
- Sky-white ground (`bg`), white rounded surfaces, soft navy ink.
- One action blue; four ladder verdicts plus a "stopped" tone are the only other hues.
- Every verdict is a pale tint with same-hue deep text and a line icon, always with its words.
- Figtree only, 400 to 700, sentence case throughout.
- Pills for everything you press, 16 to 24px rounded rectangles for everything you read.
- Answer first; details open one at a time.

## Colors

A calm, near-monochrome sky-and-navy palette with one action blue and a small set of soft verdict tints that only ever mean "how sure".

### Primary
- **Friendly Action Blue** (`blue`): primary buttons, links, the search button, topic and accordion icons, the text caret and focus ring (at 45% alpha). It marks things you can press.
- **Pressed Blue** (`blue-2`): hover for primary buttons; text on blue-wash for the current nav item, the selected topic and soft buttons.
- **Blue Wash** (`blue-wash`): fill for the current nav pill, the selected topic chip and the soft "Show all" button.

### Tertiary (verdict tones)
Each tone is a pair: a deep text colour on its own pale wash. They appear only as verdict labels and on the confidence ladder.
- **Approval Green** (`proven` on `proven-bg`): "Proven and approved".
- **Journal Teal** (`works` on `works-bg`): "Shown to work".
- **Announcement Amber** (`promising` on `promising-bg`): "Promising, not checked yet".
- **Waiting Slate** (`early` on `early-bg`): "Results not in yet", and also "Waiting for approval".
- **Muted Plum** (`stopped` on `stopped-bg`): "Didn't work or stopped". Off the ladder; used for News setbacks.

### Neutral
- **Sky-White Ground** (`bg`): page background, masthead (at 88% with a 10px blur), saved drawer.
- **Paper White** (`surface`): cards, the answer card, accordion items, chips, search field.
- **Soft Sky** (`soft`): nav hover, accordion icon tiles, the "For learning only" note, raw registry text.
- **Soft Navy Ink** (`ink`): headings, the short answer, card titles; also the tooltip and toast fill.
- **Slate Ink** (`ink-2`): body copy inside folds, ledes, nav links, ghost button text.
- **Quiet Ink** (`ink-3`): metadata, hints, dates, placeholder, chevrons, idle ladder rungs (5.07:1 on `line-2`, 5.4:1 on `bg`).
- **Hairline** (`line`): chip and search borders, ghost button ring, closed accordion ring, footer rule.
- **Faint Hairline** (`line-2`): the divider inside the answer card; idle ladder rung fill.
- **Hover Hairline** (`line-strong`): the border a chip, ghost button or Saved button takes on hover; also the scrollbar thumb.

### Named Rules
**The Blue Means Press Rule.** The blue family appears only on things that act: buttons, links, the current nav item, selected topics and the icons inside pressable chips and accordion summaries. Never use it for decoration, headings or status.

**The Verdict Owns Its Colour Rule.** Green, teal, amber, slate and plum mean "how sure we can be" and nothing else. They never colour a button state, an alert, a chart or a decoration.

**The Tint and Ink Rule.** A verdict is always a pale wash with same-hue deep text and a line icon, always with its words. Never a solid fill, never colour alone.

## Typography

**Display Font:** Figtree (with Segoe UI, system-ui, -apple-system, sans-serif)
**Body Font:** Figtree (same stack), self-hosted at 400, 500, 600 and 700.

**Character:** One warm, open geometric sans with friendly round forms. Hierarchy comes from size and weight steps, with slight negative tracking (-0.02em) on headings only.

### Hierarchy
- **Display** (700, clamp(2rem, 4.4vw, 3rem), 1.12): the page h1. The hero headline caps at 16ch and is centred; study questions, "What's new" and "About" sit left.
- **Headline** (700, clamp(1.6rem, 3vw, 2.2rem), 1.12): a long study question that would wrap past three lines at display size.
- **Title** (700, 1.4rem, 1.25): section h2s such as "The short answer", "Want to know more?", "Have a question?".
- **Subtitle** (700, 1.1rem, 1.4, -0.01em): card questions and news headlines (1.08 to 1.12rem across h3 uses).
- **Answer** (500, 1.32rem, 1.5): the one-paragraph short answer inside the answer card; 1.15rem on phones.
- **Lead** (400, 1.15rem, 1.6): the hero line under the headline, max 46ch, in `ink-2`; page intros use 1.1rem.
- **Body** (400, 18px, 1.6; 17px under 640px): fold content and prose, held to 62 to 66ch.
- **Control** (600, 1rem): button text. Nav links and chips use 500 at about 0.98rem; the selected state steps to 600.
- **Small** (400, 0.95rem): secondary reading lines: the verdict's one-line why, study facts, key-value lists, question chips, link rows and the Saved button.
- **Caption** (400, 0.9rem): hints, footer, dates, tooltip text and raw registry text (0.88 to 0.92rem).
- **Label** (600, 0.88rem): verdict labels. Ladder rungs use 0.82rem, 700 on the current rung.

### Named Rules
**The One Family Rule.** Figtree carries every role. Add weight, not a second typeface.

**The Sentence Case Rule.** Every heading, button, chip and label is sentence case at normal tracking. No uppercase, no letter-spaced labels, no small caps.

## Layout

A single centred column with a 1040px masthead and main width and a 24px gutter (16px under 640px). Home is the only browsing surface: a centred hero (headline, lede, a 640px search pill, a hint line, wrapped topic chips), then an auto-fill card grid (`minmax(min(100%, 300px), 1fr)`, 16px gaps) that becomes one column on phones. Every reading view (study, News, About) narrows to 760px (News to 820px) and runs as one column of stacked blocks; prose holds 62 to 66ch.

Views stack with 64px between sections (48px on phones); blocks inside a study page sit 28px apart; card internals use 10 to 14px gaps and 22px padding. The masthead is sticky at 68px (60px on phones) with a translucent blurred ground. One breakpoint at 640px: the brand word hides, the Saved label hides to an icon, the search pill becomes a 16px-rounded stack with a full-width button, the ladder becomes 2 by 2, and the answer card padding drops to 22px.

**The One Column for Reading Rule.** Anything meant to be read sits in a single column no wider than 760px. Grids are for choosing a study, never for reading one.

## Elevation & Depth

Soft and ambient. White surfaces lift off the sky-white ground with a single two-layer navy-tinted shadow; there are no hard edges, no offset shadows, no gradients. Interactive state can deepen the lift, and an accordion item earns its shadow only when open.

### Shadow Vocabulary
- **Rest lift** (`box-shadow: 0 1px 2px rgba(31,43,56,.04), 0 6px 20px rgba(31,43,56,.06)`): study cards, the answer card, the search field, news items, open accordion items, the labels explainer.
- **Hover lift** (`box-shadow: 0 2px 4px rgba(31,43,56,.05), 0 12px 28px rgba(31,43,56,.09)` with `translateY(-2px)`): study cards on hover only.
- **Hairline ring** (`box-shadow: inset 0 0 0 1px` `line`): closed accordion items, question-and-answer entries and ghost buttons.
- **Drawer** (`box-shadow: -12px 0 40px rgba(31,43,56,.14)` over a `rgba(31,43,56,.22)` scrim): the Saved drawer.

### Named Rules
**The Open Lifts Rule.** A closed fold is flat with a hairline; an open fold lifts with the rest shadow. Depth signals "this is the one you are reading".

## Shapes

Two shape families. Everything you press is a full pill (999px): buttons, nav links, topic and question chips, the Saved button, the search field on desktop, verdict labels, the toast. Everything you read is a rounded rectangle: 16px for cards, accordion items, notes and news items; 24px for the answer card, the most important surface on the site; 10px for ladder rungs and raw text blocks; 12px for accordion icon tiles and the tooltip. The brand mark is a 28px blue rounded square (9px) holding a white pulse line.

Icons are line icons on a 24px grid, round caps and joins, stroke 1.8, in `currentColor`, 15 to 20px.

## Components

### Buttons
Friendly, solid and obvious.
- **Shape:** full pill (999px), min-height 48px, 12px by 22px padding, 600 weight, optional 18px leading icon.
- **Primary:** `blue` fill, white text. Hover to `blue-2` over 0.15s.
- **Soft:** `blue-wash` fill, `blue-2` text, for low-stakes expansion such as "Show all 16 studies".
- **Ghost:** transparent with a 1px `line` inset ring and `ink-2` text, for the secondary action ("Official record", "Close"). Hover: white fill, `line-strong` ring, `ink` text.
- **Focus:** a 3px outline of `blue` at 45% alpha, offset 2px, everywhere.

### Chips
- **Topic chips:** white pill, 1px `line` border, 500 weight, a 20px blue line icon before the word, 44px tall. Hover takes `line-strong`. Selected (`aria-pressed`) fills `blue-wash`, drops the border and turns text `blue-2` at 600.
- **Question chips:** same pill without an icon, 0.95rem, used under "Have a question?".

### Verdict Label (signature)
The answer to "how sure can we be", carried everywhere a finding appears: study cards, the answer card, News, the Saved drawer and the labels explainer. A pill with a 15px line icon (check for proven, star for works, flag for promising, clock for early and waiting, slashed circle for stopped) and the plain label, in the Tint and Ink pairing. Never shortened to an icon or a colour.

### Answer Card (signature)
The heart of a study page: a white 24px-rounded card with 32px padding and the rest lift. It holds the "The short answer" title, the answer paragraph, a faint-hairline divider, the verdict label beside one sentence of why, and the confidence ladder.

### Confidence Ladder
Four equal rungs in a row, least to most sure: "Results not in yet", "Promising, not checked yet", "Shown to work", "Proven and approved". Idle rungs are `line-2` with `ink-3` text; the current rung takes its verdict tint, bold text and `aria-current="step"`. It shows where a finding sits without asking the reader to know the categories.

### Cards / Containers
- **Corner Style:** 16px (24px for the answer card).
- **Background:** `surface` on the `bg` ground; notes use `soft`.
- **Shadow Strategy:** rest lift; study cards gain the hover lift.
- **Border:** none on shadowed cards; a 1px inset hairline on closed folds and Q&A entries.
- **Internal Padding:** 22px (18px by 22px for folds and notes).
- **Study card:** question as subtitle, then verdict label and plain status pinned to the bottom.

### Accordion ("Want to know more?")
White 16px items stacked 10px apart. Each summary is a 36px `soft` tile holding a blue line icon, a 1.05rem 600 question, and a 20px chevron that rotates 180° over 0.25s on open. Body text is indented to the title (72px; flush on phones) in `ink-2`. Only one item stays open at a time.

### Inputs / Fields
- **Style:** a white pill with a 1px `line` border, rest lift, a 20px quiet search icon, borderless 1.05rem input and an inset primary button.
- **Focus:** the border shifts toward `blue` (50% mix).
- **Error:** the hint line below turns red and says what to do.

### Navigation
Sticky translucent masthead: brand mark and word, then pill links (Studies, News, About) in `ink-2` at 500. Hover fills `soft`; the current page fills `blue-wash` with `blue-2` text at 600. A white pill "Saved" button with a bookmark icon and count sits at the right and opens a right-hand drawer.

### Term Tooltip
Plain-language definitions sit on dotted-underlined words; a small `ink` tooltip with white 0.9rem text and 12px corners explains the term in place.

### Footer
A hairline rule, then two caption lines in `ink-3`: the not-medical-advice line and the IRB verification statement. It appears on every view.

## Do's and Don'ts

### Do:
- **Do** keep the page light: `bg` ground, `surface` cards, `ink` text. This is a single light theme.
- **Do** reserve the blue family for things that act, and the verdict tones for "how sure".
- **Do** show a verdict label, with its words, wherever a finding appears.
- **Do** lead every study with the answer card, then fold the rest into one-at-a-time accordion items.
- **Do** use full pills (999px) for controls and 16px or 24px rounded rectangles for reading surfaces.
- **Do** keep touch targets at 44px or more and buttons at 48px.
- **Do** keep reading columns at 760px or narrower and prose at 62 to 66ch.
- **Do** keep the IRB verification statement visible in the footer on every view.

### Don't:
- **Don't** add a dark mode or a dark-ground section; the light, calm ground is a user decision.
- **Don't** introduce a second accent colour or use a verdict tone for a button state, alert or decoration.
- **Don't** add uppercase eyebrows, kickers or letter-spaced labels; everything is sentence case.
- **Don't** add illustrations, mascots, gradients or loud colour.
- **Don't** show registry codes, phase numbers or key-value tables in the first layer; they live inside "Study details for the curious".
- **Don't** use hard or offset shadows; depth is the soft navy-tinted lift only.
- **Don't** mix icon families or fill icons; line icons, stroke 1.8, round caps.
