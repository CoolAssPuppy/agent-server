# V2 screen specifications

These specifications describe the Agent Server macOS app implemented in this repository. They use the existing design system and local API. Panel web and iOS must preserve the same meaning while adapting layout to their platforms.

## Today

Purpose: answer what needs attention and what is happening now.

Reading order:

1. Needs you
2. Working
3. Finished
4. Problems
5. Upcoming

Each item has one primary action selected by the server presentation model. Empty sections are omitted. Readiness attention must not duplicate an active run or pending interaction. Technical identifiers and raw events do not appear here.

## Assistants

Purpose: understand and operate one local assistant without reading its definition file.

Reading order:

1. Name, purpose, health, and the primary action
2. Readiness and a human repair action
3. Schedule and destination
4. Recent results
5. Access and connections
6. Secondary actions: Pause or Resume, Edit, History, and Safe test when enforced
7. Advanced details

Advanced details may show the raw schedule, AI engine, configured model, exact permission rules, technical connection identifiers, and local definition information. It must not show secrets or copy full instructions into Panel telemetry.

## Activity

Purpose: search and review chronological local history.

Activity is distinct from Today. Today is a bounded action queue. Activity is retained history with search, status filters, date groups, and run-review navigation.

A run review leads with outcome, summary, accomplishments, changes, outputs, problems, suggestions, operational completeness, and the human timeline. Waiting reviews explain what is needed, why, the available action, and expiry. Logs, tool calls, model data, tokens, and raw events stay under Technical details.

## Connections

Purpose: understand reusable local access to services.

Each row leads with a human label, provider or method, and the strongest status supported by local evidence. Current evidence can prove configuration readiness. It cannot prove provider health, last checked time, or assistant usage for every connection, so the UI must not fabricate those values. Setup, review, or reconnect is the single row action when supported. Credential sources and environment names remain under Technical details.

## Settings

Purpose: manage everyday preferences while keeping infrastructure secondary.

Primary cards are General, This Mac, Notifications, Appearance, and Updates. Advanced contains AI engine, Local server, Agent Panel, Diagnostics and telemetry, Environment, and Security.

This Mac shows an editable device label, local server availability, assistant count, and last heard time. Machine ID, protocol version, and server version are technical details. Agent Panel uses Configured, Disabled, Unavailable, or Not configured. Local daemon availability must never be presented as proof that Panel is connected.

## Consumer UI release rules

- One dominant action per card or row.
- Human reason and next action for every failure or waiting state.
- Text labels accompany status color and symbols.
- Keyboard focus, VoiceOver labels, text resizing, truncation, and narrow-window layout must remain usable.
- Empty, loading, offline, and partial-data states retain the last good local snapshot where safe.
- Product analytics is off until the user explicitly opts in.
- Safe test appears only when the server confirms enforcement for the selected AI engine.
