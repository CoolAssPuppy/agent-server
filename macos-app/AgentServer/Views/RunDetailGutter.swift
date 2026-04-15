import SwiftUI
import NerdsUI

struct InformationTabView: View {
    let run: Run
    let onCancel: () -> Void
    var onDelete: (() -> Void)? = nil

    @Environment(\.nTheme) private var theme
    @State private var showDeleteConfirm = false

    private var isStuck: Bool {
        guard run.status == .running else { return false }
        let elapsed = Date().timeIntervalSince(run.startedAt)
        return elapsed > 4 * 60
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xxl) {
                if let summary = run.summary, !summary.isEmpty {
                    summarySection(summary)
                }

                if !run.accomplishments.isEmpty {
                    accomplishmentsSection
                }

                if !run.observations.isEmpty {
                    observationsSection
                }

                // Error is shown in the banner above the tabs, don't duplicate.

                identifiersSection

                if hasUsage {
                    usageSection
                }

                if !run.toolsUsed.isEmpty {
                    toolsSection
                }

                if !run.filesRead.isEmpty || !run.filesWritten.isEmpty {
                    filesSection
                }

                if !run.commandsRun.isEmpty {
                    commandsSection
                }

                actionsSection
            }
            .padding(NSpacing.lg)
        }
        .confirmationDialog(
            "Delete this run?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                onDelete?()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently removes the run from the local store. This cannot be undone.")
        }
    }

    // MARK: - Output-style sections

    private func summarySection(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack {
                RunSectionHeader(title: "Summary", icon: "text.alignleft")
                Spacer()
                CopyTextButton(text: summary, label: "Copy")
            }
            MarkdownContentView(source: summary)
        }
    }

    private var accomplishmentsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Accomplishments", icon: "checkmark.circle")
            ForEach(run.accomplishments, id: \.self) { item in
                HStack(alignment: .top, spacing: NSpacing.sm) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.green)
                        .frame(width: 14)
                        .padding(.top, 2)
                    Text(item)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.foreground)
                }
            }
        }
    }

    private var observationsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Observations", icon: "eye")
            ForEach(run.observations, id: \.self) { item in
                HStack(alignment: .top, spacing: NSpacing.sm) {
                    Image(systemName: "eye")
                        .font(.system(size: 10))
                        .foregroundStyle(theme.tokens.mutedForeground)
                        .frame(width: 14)
                        .padding(.top, 2)
                    Text(item)
                        .font(NTypography.bodySmall)
                        .foregroundStyle(theme.tokens.foreground)
                }
            }
        }
    }

    private func errorSection(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            RunSectionHeader(title: "Error", icon: "exclamationmark.triangle")
            HStack(alignment: .top, spacing: NSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .padding(.top, 2)
                Text(error)
                    .font(.system(.subheadline, design: .monospaced))
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                Spacer()
                CopyTextButton(text: error, label: "Copy")
            }
            .padding(NSpacing.md)
            .background(.red.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
        }
    }

    // MARK: - Identifiers grid

    private var identifiersSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            RunSectionHeader(title: "Information", icon: "info.circle")

            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                infoRow(label: "Run ID", value: run.runId)
                infoRow(label: "Agent ID", value: run.agentId)
                if let trigger = run.trigger {
                    infoRow(label: "Trigger", value: trigger)
                }
                if let model = run.model {
                    infoRow(label: "Model", value: model)
                }
                infoRow(label: "Started", value: run.startedAt.formatted(date: .abbreviated, time: .standard))
                if let completed = run.completedAt {
                    infoRow(label: "Completed", value: completed.formatted(date: .abbreviated, time: .standard))
                }
                if let conversationId = run.conversationId {
                    infoRow(label: "Conversation", value: conversationId)
                }
            }
        }
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: NSpacing.md) {
            Text(label.uppercased())
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
                .tracking(0.5)
                .frame(width: 100, alignment: .leading)
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(theme.tokens.foreground.opacity(0.9))
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
        }
    }

    // MARK: - Usage grid

    private var hasUsage: Bool {
        run.inputTokens != nil || run.outputTokens != nil || (run.estimatedCostUsd ?? 0) > 0
    }

    private var usageSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Usage", icon: "number")
            HStack(spacing: NSpacing.xl) {
                if let input = run.inputTokens {
                    usageStat(label: "Input", value: formatTokenCount(input), color: .blue)
                }
                if let output = run.outputTokens {
                    usageStat(label: "Output", value: formatTokenCount(output), color: .orange)
                }
                if let total = run.totalTokens {
                    usageStat(label: "Total", value: formatTokenCount(total), color: theme.tokens.foreground)
                }
                if let cost = run.estimatedCostUsd, cost > 0 {
                    usageStat(label: "Cost", value: formatCost(cost), color: .green, tooltip: InfoTooltip.costExplanation)
                }
            }
        }
    }

    private func usageStat(label: String, value: String, color: Color, tooltip: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xxxs) {
            HStack(spacing: NSpacing.xxs) {
                Text(label)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                if let tooltip {
                    InfoTooltip(text: tooltip)
                }
            }
            Text(value)
                .font(.system(.subheadline, design: .monospaced, weight: .medium))
                .foregroundStyle(color)
        }
    }

    // MARK: - Tools / files / commands

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

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            if isStuck {
                Button {
                    onCancel()
                } label: {
                    Label("Cancel stuck run", systemImage: "stop.circle")
                        .font(NTypography.caption)
                        .foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
            }

            if onDelete != nil {
                Button {
                    showDeleteConfirm = true
                } label: {
                    Label("Delete this run", systemImage: "trash")
                        .font(NTypography.caption)
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, NSpacing.md)
    }
}
