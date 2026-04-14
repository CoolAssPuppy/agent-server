import SwiftUI
import NerdsUI

struct DetailsTabView: View {
    let run: Run

    @Environment(\.nTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xxl) {
                informationSection

                if !run.toolsUsed.isEmpty {
                    toolsSection
                }

                if !run.filesWritten.isEmpty || !run.filesRead.isEmpty {
                    filesSection
                }

                if !run.commandsRun.isEmpty {
                    commandsSection
                }
            }
            .padding(NSpacing.lg)
        }
    }

    // MARK: - Information

    private var informationSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            RunSectionHeader(title: "Information", icon: "info.circle")

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: NSpacing.md) {
                infoCell(label: "Agent ID", value: run.agentId)
                infoCell(label: "Run ID", value: String(run.runId.prefix(8)))

                if let model = run.model {
                    infoCell(label: "Model", value: model)
                }

                if let trigger = run.trigger {
                    infoCell(label: "Trigger", value: trigger)
                }

                infoCell(label: "Started", value: run.startedAt.formatted(date: .abbreviated, time: .standard))

                if let completed = run.completedAt {
                    infoCell(label: "Completed", value: completed.formatted(date: .abbreviated, time: .standard))
                }

                if let duration = run.duration {
                    infoCell(label: "Duration", value: formatDuration(duration))
                }

                if let tokens = run.totalTokens {
                    infoCell(label: "Total tokens", value: formatTokenCount(tokens))
                }

                if let cost = run.estimatedCostUsd, cost > 0 {
                    infoCell(label: "Cost", value: formatCost(cost), tooltip: InfoTooltip.costExplanation)
                }

                if run.conversationId != nil {
                    infoCell(label: "Conversation", value: String(run.conversationId!.prefix(8)))
                }
            }
        }
    }

    private func infoCell(label: String, value: String, tooltip: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xxxs) {
            HStack(spacing: NSpacing.xxs) {
                Text(label)
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
                if let tooltip {
                    InfoTooltip(text: tooltip)
                }
            }
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(theme.tokens.foreground)
                .textSelection(.enabled)
        }
    }

    // MARK: - Tools

    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Tools (\(run.toolsUsed.count))", icon: "wrench.and.screwdriver")

            FlowLayout(spacing: NSpacing.xs) {
                ForEach(run.toolsUsed, id: \.self) { tool in
                    ToolTag(name: tool)
                }
            }
        }
    }

    // MARK: - Files

    private var filesSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            RunSectionHeader(title: "Files", icon: "doc.text")

            HStack(alignment: .top, spacing: NSpacing.xxl) {
                if !run.filesWritten.isEmpty {
                    VStack(alignment: .leading, spacing: NSpacing.xxs) {
                        Text("Written (\(run.filesWritten.count))")
                            .font(NTypography.labelSmall)
                            .foregroundStyle(.green)

                        ForEach(run.filesWritten, id: \.self) { file in
                            fileRow(file, color: .green)
                        }
                    }
                }

                if !run.filesRead.isEmpty {
                    VStack(alignment: .leading, spacing: NSpacing.xxs) {
                        Text("Read (\(run.filesRead.count))")
                            .font(NTypography.labelSmall)
                            .foregroundStyle(theme.tokens.mutedForeground)

                        ForEach(run.filesRead, id: \.self) { file in
                            fileRow(file, color: theme.tokens.mutedForeground)
                        }
                    }
                }
            }
        }
    }

    private func fileRow(_ file: String, color: Color) -> some View {
        Text(abbreviatePath(file))
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(color)
            .textSelection(.enabled)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    // MARK: - Commands

    private var commandsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Commands (\(run.commandsRun.count))", icon: "terminal")

            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                ForEach(run.commandsRun, id: \.self) { command in
                    HStack(alignment: .top, spacing: NSpacing.xs) {
                        Text("$")
                            .font(.system(.caption, design: .monospaced, weight: .bold))
                            .foregroundStyle(theme.tokens.mutedForeground)
                        Text(command)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(theme.tokens.foreground.opacity(0.8))
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }
}
