# Installed agent migration report

Status: applied and verified locally. User review is required before commit.

## Current machine state

The migration found seven installed agents. Six remain enabled and
`proactive-work` remains disabled. Their shared files have no `executor`,
`model`, `provider`, concrete MCP tool name, account ID, or provider resource
ID. `daily-manuscript-review` no longer has a Codex-only sandbox field.

This machine now has:

- eight saved connection profiles
- seven local Claude Code runtime assignments
- seven portable agent binding sets
- checked capability snapshots and reviewed operation mappings for every
  connection used by the six enabled agents
- installed Claude Code and Codex executables
- no installed Kimi Code executable

All six enabled agents pass preparation and runtime compatibility checks on
Claude Code. `proactive-work` reports only its missing Customer.io connection,
which is expected while it remains disabled. Harmless one-turn executions
returned `runtime-ready` through both Claude Code and Codex.

## Change shared by all seven agents

The agent Markdown will continue to own the task: ID, name, description,
schedule, timezone, task instructions, output count, retry policy, notification
settings, and conversation settings.

The migration will make these changes in each applicable file:

1. Add `connections` entries with a logical key, service type, human name,
   purpose, semantic operations, and logical resources.
2. Remove concrete `mcp__...` entries from `tools`, `permissions`, and
   `disallowed_tools` after their replacements pass capability checks.
3. Remove inline `mcp_servers`. Commands, URLs, and credential references move
   into local saved connection profiles.
4. Change the primary output contract from a concrete MCP tool and provider ID
   to `{ use, operation, target }`.
5. Replace concrete tool names and provider IDs in the prompt with logical
   connection, operation, and resource names.
6. Save the selected runtime in `~/.agent-server/runtime-assignments.json`.
   Future runtime changes edit that local record only.
7. Save actual account and provider resource choices in
   `~/.agent-server/agent-bindings.json`.

The migration does not change schedules, page counts, destinations, read/write
rules, failure behavior, or notification routing.

Each definition change will use the reviewed configuration-patch path. The
server computes a hash of the current file, returns the proposed field changes
and result hash, and requires confirmation of that exact preview before an
atomic replacement. The per-agent sections below provide the prompt changes
that the API intentionally redacts. A changed source file invalidates the
preview. A successful replacement returns a rollback token.

Local file tools such as `Read`, `Glob`, `Write`, and `Bash` remain supported
legacy fields. `file_access` supplies the cross-runtime file boundary. This
release does not provide logical local-file bindings, so an absolute file path
can be LLM-neutral while remaining specific to one machine.

Every Notion profile in this migration must use the reviewed package command
`npx -y @notionhq/notion-mcp-server@2.5.1`. An unpinned or differently pinned
package gets a new capability identity and requires another operation review.

## Daily Portuguese and French

Frontmatter replacement:

- Add `personal_notes`, type `notion`, name `Notion Personal`.
- Declare `notion.data_source.query`, `notion.page.read`, and
  `notion.page.create`.
- Add writable resource `lesson_database`, type `notion.data_source`.
- Remove the inline `notion-personal` MCP server and every concrete Notion MCP
  allow and deny entry.
- Replace the required output with `use: personal_notes`,
  `operation: notion.page.create`, `target: lesson_database`, and exactly two
  successful calls.

Prompt replacement:

- Replace the three Notion REST tool names with the three semantic operations.
- Replace data source `255a555c-5905-80c0-9c85-000bc083f813` with
  `personal_notes.lesson_database`.
- Keep the query limits, lesson format, two-page order, read-only rule, and
  failure behavior.

Local setup:

- `Notion Personal` uses the local `NOTION_PERSONAL_API_KEY` reference.
- Its checked inventory and reviewed operation mappings are current.
- `lesson_database` is bound locally to the existing personal Notes database.
- Claude Code is the current local runtime assignment.

## Daily Manuscript Review

Frontmatter replacement:

- Add `personal_notes`, type `notion`, name `Notion Personal`.
- Declare `notion.search`, `notion.data_source.read`,
  `notion.data_source.query`, `notion.page.read`, and `notion.page.create`.
- Add writable resource `review_database`, type `notion.data_source`.
- Remove the inline `notion-personal` MCP server, concrete Notion MCP rules,
  the unused Claude Parallel Search permission, and `codex_sandbox`.
- Replace the conditional output with `use: personal_notes`,
  `operation: notion.page.create`, and `target: review_database`. It stays
  conditional because unchanged manuscripts produce no page.

Prompt replacement:

- Replace concrete Notion names and the personal data source ID with logical
  names.
- Keep the manuscript hash check, the no-change exit, report criteria, failure
  log, and rule that the stored hash changes only after a successful page write.

Local setup:

- Reuse `Notion Personal` and bind `review_database` to
  `255a555c-5905-80c0-9c85-000bc083f813`.
- Keep the current three `file_access` entries for the first migration. They
  already constrain all three runtimes, but the Google Drive and development
  paths remain machine-specific.
- Claude Code is the current local runtime assignment. A future Codex sandbox
  choice will remain local.

Making this agent portable across machines needs a separate local-file binding
feature or matching paths on the destination machine. That feature is outside
the connection work implemented here.

## CMO Coaching Report

Frontmatter replacement:

- Add `work_messages`, type `slack`, name `Slack Work`, for user lookup,
  message search, message reads, and thread reads.
- Add `work_projects`, type `linear`, name `Linear Work`, for user, issue,
  project, initiative, and comment reads and searches.
- Add `work_notes`, type `notion`, name `Notion Work`, for work-page search and
  reads.
- Add `personal_notes`, type `notion`, name `Notion Personal`, for prior-report
  queries, page reads, and one report creation.
- Add `subject_user` logical resources where a connection needs the local user
  identity.
- Add writable `report_database` under `personal_notes`.
- Remove all Claude account MCP names, the unused Hex and Parallel Search
  entries, and the inline personal Notion server.
- Replace the required output with one `notion.page.create` call through
  `personal_notes.report_database`.

Prompt replacement:

- Replace the hardcoded Slack user ID `U087GTN6HFB` with the local
  `work_messages.subject_user` resource.
- Replace the personal data source ID with
  `personal_notes.report_database`.
- Replace tool-call recipes with semantic operation instructions. Keep the
  seven-day window, leader list, grading method, static reading list, citations,
  report format, and no-notification rule.

Local setup:

- Reuse `Notion Personal` and its report database binding.
- Saved `Slack Work`, `Linear Work`, and `Notion Work` profiles use the existing
  Claude account connections on this machine.
- Each requested operation has a checked inventory entry and reviewed mapping.
- The Slack and Linear user identities are bound locally.
- Claude Code is the current local runtime assignment.

## Daily Focus List

Frontmatter replacement:

- Add `work_messages`, type `slack`, name `Slack Work`.
- Add `work_projects`, type `linear`, name `Linear Work`.
- Add `work_notes`, type `notion`, name `Notion Work`.
- Add `work_mail`, type `gmail`, name `Gmail Work`.
- Add `work_calendar`, type `calendar`, name `Calendar Work`.
- Declare only the read and search operations the prompt uses, plus
  `notion.page.create` for the report.
- Add `subject_user` resources for Slack and Linear and writable
  `focus_database` under `work_notes`.
- Remove both inline Linear and Slack servers, all concrete MCP rules, and the
  unused Hex and Parallel Search entries.
- Replace the required output with one `notion.page.create` call through
  `work_notes.focus_database`.
- Remove the concrete Slack tool from `output.notification`. Agent Server
  already sends the final assistant message through `notification.channel`.

Prompt replacement:

- Replace hardcoded Slack user ID `U087GTN6HFB`, the Notion data source ID, and
  concrete tool recipes with logical resources and semantic operations.
- Remove the text that chooses between Claude account tools and inline MCP
  tools.
- Keep the 24-hour windows, query budgets, prioritization, one-page rule,
  failure log, and server-owned Slack notification behavior.

Local setup:

- Saved `Slack Work`, `Linear Work`, `Notion Work`, `Gmail Work`, and
  `Calendar Work` profiles use the existing Claude account connections.
- Their requested operations have checked inventory entries and reviewed
  mappings.
- `focus_database` and both local user identities are bound locally.
- Keep `/Users/prashant/Developer/brain/notes/Supabase/` in `file_access` for
  this machine. Moving that path outside the agent requires local-file bindings,
  which this release does not yet have.

The existing bundled EventKit helper is saved separately for future Codex or
Kimi use. This agent currently uses the checked Claude Calendar account profile.

## Proactive Work

Frontmatter replacement:

- Add `work_projects`, type `linear`, name `Linear Work`, for assigned issue,
  project, and comment reads.
- Add `work_notes`, type `notion`, name `Notion Work`, for source reads and new
  draft pages.
- Add `work_messages`, type `slack`, name `Slack Work`, for supporting context.
- Add `customer_messaging`, type `customer_io`, name `Customer.io Work`, for
  authentication state, schema, skill, and content reads.
- Add `subject_user` resources and writable `draft_database` under
  `work_notes`.
- Remove all concrete MCP allow and deny entries.
- Replace the output with `notion.page.create` through
  `work_notes.draft_database`. It remains conditional and may occur once per
  processed issue.

Prompt replacement:

- Replace the work Notion data source ID and concrete tool names with logical
  names.
- Keep every source read-only, keep Notion page creation as the only remote
  write, and keep the state-file update after a complete issue flow.

Local setup:

- The saved Linear, Notion, and Slack profiles and local resources are bound.
- `Customer.io Work` remains unbound.
- Keep `/Users/prashant/Developer/brain/.cowork/processed-issues.json` and the
  referenced writing files as machine-specific file access for now.
- Keep this agent disabled during migration.

Customer.io has no curated mapping yet. Its capability inventory needs an
explicit, version-pinned operation review before this agent can run from the
portable definition.

## Weekly Goals Report

Frontmatter replacement:

- Add `work_messages`, type `slack`, name `Slack Work`.
- Add `work_projects`, type `linear`, name `Linear Work`.
- Add `work_notes`, type `notion`, name `Notion Work`.
- Add `subject_user` resources and writable `report_database` under
  `work_notes`.
- Remove every concrete MCP entry and the unused Hex entry.
- Replace the output with exactly one `notion.page.create` call through
  `work_notes.report_database`.
- Remove the concrete Slack notification tool. Agent Server owns that send.

Prompt replacement:

- Replace Slack user ID `U087GTN6HFB`, the work Notion data source ID, and
  concrete Notion recipes with logical names.
- Keep the prior-report lookup, date windows, dedup rules, priority format,
  one-page rule, failure log, and server-owned Slack notification.

Local setup:

- Reuse the reviewed `Slack Work`, `Linear Work`, and `Notion Work` profiles.
- Bind `report_database` to `8dd5004b-775f-8339-b38f-87b1e08ebe79` and bind the
  local user identities.
- Claude Code is the current local runtime assignment.

## Weekly Status Report

Frontmatter replacement:

- Add `work_messages`, type `slack`, name `Slack Work`.
- Add `work_projects`, type `linear`, name `Linear Work`.
- Add `work_notes`, type `notion`, name `Notion Work`.
- Add `subject_user` resources and writable `report_database` under
  `work_notes`.
- Remove every concrete MCP entry and the unused Hex and Parallel Search
  entries.
- Replace the output with exactly one `notion.page.create` call through
  `work_notes.report_database`.

Prompt replacement:

- Replace Slack user ID `U087GTN6HFB`, the work Notion data source ID, and
  concrete Notion recipes with logical names.
- Keep the Wednesday schedule, two-report dedup lookup, grouping rules,
  citation rules, one-page requirement, failure log, and no-notification rule.

Local setup:

- Reuse the reviewed `Slack Work`, `Linear Work`, and `Notion Work` profiles.
- Bind `report_database` to `8dd5004b-775f-8339-b38f-87b1e08ebe79` and bind the
  local user identities.
- Claude Code is the current local runtime assignment.

## Approved migration decisions

1. Apply all seven migrations.
2. Keep Claude Calendar for the first `daily-focus` assignment and explain the
   separate Codex and ChatGPT setup.
3. Keep machine-specific synced paths in `file_access`.
4. Remove unused Hex and Parallel Search permissions.
5. Keep `proactive-work` disabled.

The seven files and machine-local settings now reflect these decisions. No
commit has been created.
