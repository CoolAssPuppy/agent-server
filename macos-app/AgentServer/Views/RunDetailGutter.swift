import SwiftUI
import NerdsUI

struct RunDetailGutter: View {
    let run: Run

    @Environment(\.nTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                if !run.toolsUsed.isEmpty {
                    toolsSection
                }

                if !run.filesWritten.isEmpty || !run.filesRead.isEmpty {
                    filesSection
                }

                if !run.commandsRun.isEmpty {
                    commandsSection
                }

                informationSection
            }
            .padding(NSpacing.lg)
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
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Files", icon: "doc.text")

            if !run.filesWritten.isEmpty {
                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    Text("Written (\(run.filesWritten.count))")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(.green)

                    ForEach(run.filesWritten, id: \.self) { file in
                        fileRow(file, color: .green)
                    }
                }
            }

            if !run.filesRead.isEmpty {
                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    Text("Read (\(run.filesRead.count))")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)

                    ForEach(run.filesRead, id: \.self) { file in
                        fileRow(file, color: theme.tokens.mutedForeground)
                    }
                }
            }
        }
    }

    private func fileRow(_ file: String, color: Color) -> some View {
        Text(abbreviatePath(file))
            .font(.system(.caption2, design: .monospaced))
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
                    HStack(alignment: .top, spacing: NSpacing.xxs) {
                        Text("$")
                            .font(.system(.caption2, design: .monospaced, weight: .bold))
                            .foregroundStyle(theme.tokens.mutedForeground)
                        Text(command)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(theme.tokens.foreground.opacity(0.8))
                            .textSelection(.enabled)
                            .lineLimit(2)
                    }
                }
            }
        }
    }

    // MARK: - Information

    private var informationSection: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            RunSectionHeader(title: "Information", icon: "info.circle")

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                infoRow(label: "Agent ID", value: run.agentId)
                infoRow(label: "Run ID", value: String(run.runId.prefix(8)))

                if let model = run.model {
                    infoRow(label: "Model", value: model)
                }

                if let trigger = run.trigger {
                    infoRow(label: "Trigger", value: trigger)
                }

                HStack(spacing: NSpacing.xxs) {
                    Text("Started")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    Spacer()
                    Text(run.startedAt, style: .date)
                        .font(.system(.caption2, design: .monospaced))
                    Text(run.startedAt, style: .time)
                        .font(.system(.caption2, design: .monospaced))
                }
            }
        }
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack(spacing: NSpacing.xxs) {
            Text(label)
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text(value)
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(theme.tokens.foreground)
                .textSelection(.enabled)
        }
    }
}
