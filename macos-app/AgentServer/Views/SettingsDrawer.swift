import SwiftUI
import AgentServerDesignSystem

/// Settings drawer composed from stable section views and a pure settings draft.
struct SettingsDrawer: View {
    @ObservedObject var monitor: StatusMonitor
    @ObservedObject var router: DrawerRouter

    @State var draft = SettingsDraft()
    @State var workspace = AgentServerWorkspaceStore.current()
    @State var revealedKeys: Set<String> = []
    @State var editingKey: String?
    @State var selectedIndex: Int?
    @State var launchAtLogin = LaunchAtLoginManager.shared.isEnabled
    @State var telemetryOptIn = Telemetry.isOptedIn
    @State var showAdvancedSettings = false
    @State var didLoad = false
    @State var workspaceReloadTask: Task<Void, Never>?

    var body: some View {
        TopDrawerSurface(
            title: "Settings",
            closeLabel: "Close settings",
            onClose: router.close,
            showsDivider: false
        ) {
            content
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            loadPairs(from: workspace.environmentFile)
        }
        .onDisappear {
            workspaceReloadTask?.cancel()
        }
    }

    private var content: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.lg) {
                    primarySectionColumns
                    SettingsAdvancedDisclosure(isExpanded: $showAdvancedSettings)
                    if showAdvancedSettings {
                        sectionGrid(
                            SettingsPresentation.advancedSections,
                            availableWidth: proxy.size.width
                        )
                        .accessibilityIdentifier("settings.advancedContent")
                    }
                }
                .padding(.horizontal, NSpacing.xxl)
                .padding(.bottom, NSpacing.xxl)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private var primarySectionColumns: some View {
        HStack(alignment: .top, spacing: NSpacing.lg) {
            ForEach(SettingsPresentation.primaryColumns.indices, id: \.self) { columnIndex in
                VStack(alignment: .leading, spacing: NSpacing.lg) {
                    ForEach(SettingsPresentation.primaryColumns[columnIndex], id: \.self) {
                        sectionView(for: $0)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }

    private func sectionGrid(
        _ sections: [SettingsSection],
        availableWidth: CGFloat
    ) -> some View {
        let contentWidth = max(0, availableWidth - (NSpacing.xxl * 2))
        let count = SettingsPresentation.columnCount(availableWidth: Double(contentWidth))
        return LazyVGrid(
            columns: Array(
                repeating: GridItem(
                    .flexible(minimum: 280),
                    spacing: NSpacing.lg,
                    alignment: .top
                ),
                count: count
            ),
            alignment: .leading,
            spacing: NSpacing.lg
        ) {
            ForEach(sections, id: \.self) { sectionView(for: $0) }
        }
    }

    @ViewBuilder
    private func sectionView(for section: SettingsSection) -> some View {
        switch section {
        case .general:
            SettingsGeneralSection(
                monitor: monitor,
                launchAtLogin: $launchAtLogin,
                resumeAfterWake: resumeAfterWakeBinding,
                requiresRestart: draft.requiresGeneralRestart,
                telemetryOptIn: $telemetryOptIn,
                onRestart: restartForGeneralChange
            )
        case .runtimes:
            SettingsRuntimeSection(
                usesInstalledClaude: runtimeBinding(\.usesInstalledClaude),
                usesInstalledCodex: runtimeBinding(\.usesInstalledCodex),
                usesInstalledKimi: runtimeBinding(\.usesInstalledKimi),
                requiresRestart: draft.requiresRuntimeRestart,
                onRestart: restartForRuntimeChange
            )
        case .notifications:
            SettingsNotificationsSection()
        case .storage:
            SettingsStorageSection(
                workspace: workspace,
                onChoose: chooseWorkspace,
                onOpen: { SettingsWorkspaceActions.open(workspace) },
                onRestoreDefault: restoreDefaultWorkspace
            )
        case .updates:
            SettingsUpdatesSection()
        case .agentPanel:
            SettingsAgentPanelSection(
                isSending: panelSendingBinding,
                connection: draft.panelConnection(isServerReachable: monitor.isServerReachable),
                requiresRestart: draft.requiresPanelRestart,
                telemetry: telemetryBinding,
                onRestart: restartForPanelChange
            )
        case .environment:
            EnvironmentSettingsCard(
                pairs: $draft.pairs,
                revealedKeys: $revealedKeys,
                editingKey: $editingKey,
                invalidKeys: invalidKeysBinding,
                selectedIndex: $selectedIndex,
                saveError: draft.errorMessage,
                onRefreshValidation: {},
                onPersist: persistEnvironmentDraft
            )
        }
    }
}
