import SwiftUI
import NerdsUI

struct EnvironmentSettingsCard: View {
    @Binding var pairs: [EnvPair]
    @Binding var revealedKeys: Set<String>
    @Binding var editingKey: String?
    @Binding var invalidKeys: Set<String>
    @Binding var selectedIndex: Int?
    let saveError: String?
    let onRefreshValidation: () -> Void
    let onPersist: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        SettingsCard(title: "Environment") {
            Text("Advanced values used by the local server. Secrets stay on this Mac.")
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)

            VStack(alignment: .leading, spacing: NSpacing.xs) {
                environmentGrid
                gridToolbar

                if !invalidKeys.isEmpty {
                    Text("Keys must match `[A-Z][A-Z0-9_]*`.")
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.destructive)
                }
                if let saveError {
                    Text(saveError)
                        .font(NTypography.captionSmall)
                        .foregroundStyle(theme.tokens.destructive)
                }
            }
        }
    }

    private var environmentGrid: some View {
        VStack(spacing: 0) {
            headerRow
                .padding(.horizontal, NSpacing.sm)
                .padding(.vertical, 6)
            Divider().opacity(0.4)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(pairs.enumerated()), id: \.offset) { index, pair in
                        connectionRow(index: index, pair: pair)
                            .padding(.horizontal, NSpacing.sm)
                            .padding(.vertical, 4)
                            .background(
                                selectedIndex == index
                                    ? theme.tokens.primary.opacity(0.10)
                                    : Color.clear
                            )
                            .contentShape(Rectangle())
                            .onTapGesture { selectedIndex = index }
                        if index < pairs.count - 1 {
                            Divider().opacity(0.25)
                        }
                    }
                }
            }
            .frame(minHeight: 110, maxHeight: 240)
        }
        .background(
            RoundedRectangle(cornerRadius: NRadius.sm)
                .fill(theme.tokens.background)
                .overlay(
                    RoundedRectangle(cornerRadius: NRadius.sm)
                        .stroke(theme.tokens.border, lineWidth: 1)
                )
        )
    }

    private var headerRow: some View {
        HStack(spacing: NSpacing.sm) {
            columnTitle("KEY")
            columnTitle("VALUE")
        }
    }

    private func columnTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.6)
            .foregroundStyle(theme.tokens.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var gridToolbar: some View {
        HStack(spacing: 0) {
            toolbarButton(systemName: "plus", help: "Add environment value", action: appendRow)

            Divider().frame(height: 14).opacity(0.4)

            toolbarButton(
                systemName: "minus",
                help: "Remove selected environment value",
                isDisabled: selectedIndex == nil,
                action: removeSelectedRow
            )

            Spacer()
        }
        .background(
            RoundedRectangle(cornerRadius: NRadius.xs)
                .stroke(theme.tokens.border, lineWidth: 1)
        )
    }

    private func toolbarButton(
        systemName: String,
        help: String,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(
                    isDisabled
                        ? theme.tokens.mutedForeground.opacity(0.5)
                        : theme.tokens.foreground
                )
                .frame(width: 24, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .help(help)
    }

    private func connectionRow(index: Int, pair: EnvPair) -> some View {
        HStack(spacing: NSpacing.sm) {
            keyField(index: index, pair: pair)
                .frame(maxWidth: .infinity, alignment: .leading)
            valueField(index: index, pair: pair)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func keyField(index: Int, pair: EnvPair) -> some View {
        let binding = Binding<String>(
            get: { pairs[index].key },
            set: { newKey in
                pairs[index] = EnvPair(
                    key: newKey,
                    value: pairs[index].value,
                    isSecret: EnvFileStore.isSecretKey(newKey)
                )
                onRefreshValidation()
            }
        )
        return TextField("KEY", text: binding, onCommit: onPersist)
            .environmentFieldStyle(hasError: invalidKeys.contains(pair.key), theme: theme)
    }

    @ViewBuilder
    private func valueField(index: Int, pair: EnvPair) -> some View {
        let isRevealed = revealedKeys.contains(pair.key)
        let shouldMask = pair.isSecret && !isRevealed
        let isEditing = editingKey == pair.key && !shouldMask

        if shouldMask {
            HStack(spacing: NSpacing.xxs) {
                Text(EnvFileStore.masked(value: pair.value))
                    .lineLimit(1)
                Spacer()
                Button {
                    revealedKeys.insert(pair.key)
                } label: {
                    Image(systemName: "eye")
                        .font(.system(size: 10))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Reveal \(pair.key)")
            }
            .environmentFieldStyle(theme: theme)
            .onTapGesture {
                revealedKeys.insert(pair.key)
                editingKey = pair.key
            }
        } else {
            let binding = Binding<String>(
                get: { pairs[index].value },
                set: { newValue in
                    pairs[index] = EnvPair(
                        key: pairs[index].key,
                        value: newValue,
                        isSecret: pairs[index].isSecret
                    )
                }
            )
            HStack(spacing: NSpacing.xxs) {
                TextField("value", text: binding, onCommit: {
                    editingKey = nil
                    onPersist()
                })
                .textFieldStyle(.plain)
                if pair.isSecret && isEditing {
                    Button {
                        revealedKeys.remove(pair.key)
                        editingKey = nil
                        onPersist()
                    } label: {
                        Image(systemName: "eye.slash")
                            .font(.system(size: 10))
                            .foregroundStyle(theme.tokens.mutedForeground)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Hide \(pair.key)")
                }
            }
            .environmentFieldStyle(theme: theme)
        }
    }

    private func appendRow() {
        pairs.append(EnvPair(key: "", value: "", isSecret: false))
        selectedIndex = pairs.count - 1
        onRefreshValidation()
    }

    private func removeSelectedRow() {
        guard let selectedIndex, pairs.indices.contains(selectedIndex) else { return }
        let removed = pairs.remove(at: selectedIndex)
        revealedKeys.remove(removed.key)
        onRefreshValidation()
        onPersist()

        self.selectedIndex = pairs.isEmpty
            ? nil
            : min(selectedIndex, pairs.count - 1)
    }
}

private extension View {
    func environmentFieldStyle(hasError: Bool = false, theme: ThemeConfiguration) -> some View {
        self
            .textFieldStyle(.plain)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(theme.tokens.foreground)
            .padding(.horizontal, NSpacing.xs)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: NRadius.xs)
                    .fill(theme.tokens.background)
                    .overlay(
                        RoundedRectangle(cornerRadius: NRadius.xs)
                            .stroke(hasError ? theme.tokens.destructive : theme.tokens.border, lineWidth: 1)
                    )
            )
    }
}
