# macOS visual system

## Product position

Agent Server should feel calm, precise, and trustworthy before it feels technical. The app serves knowledge workers and tinkerers, so common decisions must be clear while exact configuration remains available on request.

The app keeps its existing Agent Server palettes, spacing tokens, progressive panels, native controls, and local-first architecture. This specification removes decorative containment and inconsistent typography. It does not add a second design system.

## Audit baseline

The July 2026 audit found:

- 384 font modifiers across macOS views
- 113 direct system font declarations mixed with semantic typography tokens
- 79 explicit backgrounds
- 74 rounded rectangles
- 26 card-style `ConsumerSection` uses
- 11 capsule treatments
- 28 animation calls, with only 7 explicit Reduce Motion checks

The main interaction architecture is sound. Window routing, progressive drawers, native schedule and file controls, keyboard actions, global text selection, and critical accessibility identifiers should remain.

## Composition rules

### Surfaces

Use one base surface for a window, drawer, or sheet. Within it, prefer spacing, section labels, rows, and dividers.

One inset or elevated surface may be used when it communicates a meaningful state or primary object, such as Up next, Overall status, or Last run. Do not place bordered cards inside bordered cards.

Grouped rows may share one quiet background and border. Individual rows do not receive their own card background. Selection may add one subtle full-row tint.

### Typography

Use these roles:

1. Drawer or page title
2. Section label
3. Primary body or row title
4. Secondary or status text
5. Technical text, shown only after disclosure

Monospaced text is reserved for exact configuration, logs, paths, identifiers, and patches. An error summary remains in the normal body face.

Do not mix several nearby custom point sizes in one view. Do not use uppercase text as a substitute for hierarchy unless the same section-label treatment is used across the product.

### Status

Show status with an SF Symbol and text. Color supports the meaning but never carries it alone. Use capsules only for compact counts or true tags. Risk, readiness, connection state, and server health should share the same icon-and-text grammar.

### Actions

Each surface has one clear primary action. Secondary actions use native bordered, plain, menu, or disclosure treatments. Drawer actions use the shared toolbar style and remain in a consistent order before Close.

### Progressive disclosure

The first level answers what is happening and what the user should do. The next level explains consequences and choices. Advanced details show exact configuration, logs, patches, and identifiers.

Selecting a list item opens the next panel to the right. Escape and Back close the deepest panel first. Reduce Motion removes the slide transition without changing navigation.

## Screen priorities

### Security Check

Use one Overall status surface, one grouped agent list, one grouped finding list per severity, and one finding-detail panel. Keep the agent list visible while scanning. Do not use risk capsules or nested finding cards.

### Agent creation

Keep the conversational entry and native pickers. Flatten proposal subsections into inset rows. Use one review summary and one primary save action. Connection, file, calendar, and permission detail should not each create a new card layer.

### Connections

Keep named connections and progressive detail panels. Use native section headers and grouped rows. Present readiness, credentials, transport, and management as a continuous detail form instead of separate cards.

### Agent detail and settings

Use one reading hierarchy for schedule, safety, last run, capabilities, and settings. Keep Last run as the optional elevated object. Use sentence-case labels and reveal exact configuration under Advanced.

### Activity and debugger

Lead with plain-language outcome and recovery. Keep raw run identifiers, logs, tool calls, and exact errors under Information or Technical details. Use the shared drawer chrome and avoid one card per paragraph.

### App settings

Use a native continuous form or restrained flat sections. General, coding agents, notifications, folder, and updates lead. Agent Panel and environment values remain under Advanced. Replace the web-style card grid and card borders.

### Menu bar and sidebar

Use Buttons for actionable rows. Theme selection belongs in a labeled, accessible control. All movement honors Reduce Motion. Selection uses one native fill, without an extra border.

## Accessibility checks

- Preserve full keyboard navigation and logical focus order.
- Restore focus to the control that opened a dismissed drawer or sheet.
- Include icons and text for severity and state.
- Do not truncate the only recovery message.
- Test minimum window sizes and large text without fixed-height content loss.
- Check contrast across every included palette in light and dark appearances.
- Keep decorative motion disabled when Reduce Motion is on.

UI automation is intentionally excluded from routine development verification because it steals user focus. Behavior tests, previews, accessibility inspection, and unsigned builds are the normal feedback loop. Focused UI testing should run only in an isolated environment.
