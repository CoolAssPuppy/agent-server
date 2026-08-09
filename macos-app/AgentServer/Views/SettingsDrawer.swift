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

    @Environment(\.nTheme) private var theme

    var body: some View {
        TopDrawerSurface(
            title: "Settings",
            subtitle: "Preferences for Agent Server",
            closeLabel: "Close settings",
            onClose: router.close,
            showsDivider: true,
            titleFont: .system(
                size: CGFloat(SettingsPresentation.drawerTitleFontSize),
                weight: .semibold
            ),
            headerHorizontalPadding: CGFloat(SettingsPresentation.headerHorizontalPadding),
            headerTopPadding: CGFloat(SettingsPresentation.headerVerticalPadding),
            headerBottomPadding: CGFloat(SettingsPresentation.headerVerticalPadding)
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
                VStack(
                    alignment: .leading,
                    spacing: CGFloat(SettingsPresentation.interCardSpacing)
                ) {
                    primarySectionColumns
                    SettingsAdvancedDisclosure(isExpanded: $showAdvancedSettings)
                    if showAdvancedSettings {
                        advancedSectionLayout(availableWidth: proxy.size.width)
                        .accessibilityIdentifier("settings.advancedContent")
                    }
                }
                .padding(.horizontal, CGFloat(SettingsPresentation.outerHorizontalPadding))
                .padding(.top, CGFloat(SettingsPresentation.outerTopPadding))
                .padding(.bottom, CGFloat(SettingsPresentation.outerBottomPadding))
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(theme.tokens.background)
        }
    }

    private var primarySectionColumns: some View {
        HStack(
            alignment: .top,
            spacing: CGFloat(SettingsPresentation.interCardSpacing)
        ) {
            ForEach(SettingsPresentation.primaryColumns.indices, id: \.self) { columnIndex in
                VStack(
                    alignment: .leading,
                    spacing: CGFloat(SettingsPresentation.interCardSpacing)
                ) {
                    ForEach(SettingsPresentation.primaryColumns[columnIndex], id: \.self) {
                        sectionView(for: $0)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
    }

    @ViewBuilder
    private func advancedSectionLayout(availableWidth: CGFloat) -> some View {
        let contentWidth = max(
            0,
            availableWidth - (CGFloat(SettingsPresentation.outerHorizontalPadding) * 2)
        )
        let count = SettingsPresentation.columnCount(availableWidth: Double(contentWidth))

        if count == 1 {
            VStack(alignment: .leading, spacing: CGFloat(SettingsPresentation.interCardSpacing)) {
                ForEach(SettingsPresentation.advancedSections, id: \.self) {
                    sectionView(for: $0)
                }
            }
        } else {
            HStack(alignment: .top, spacing: CGFloat(SettingsPresentation.interCardSpacing)) {
                ForEach(SettingsPresentation.advancedColumns.indices, id: \.self) { columnIndex in
                    VStack(
                        alignment: .leading,
                        spacing: CGFloat(SettingsPresentation.interCardSpacing)
                    ) {
                        ForEach(SettingsPresentation.advancedColumns[columnIndex], id: \.self) {
                            sectionView(for: $0)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
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
                onRestart: restartForGeneralChange
            )
        case .device:
            SettingsDeviceSection(presentation: monitor.currentDevicePresentation)
        case .pairing:
            SettingsPairingSection(monitor: monitor)
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
                connection: draft.panelConnection(),
                requiresRestart: draft.requiresPanelRestart,
                telemetry: telemetryBinding,
                onRestart: restartForPanelChange
            )
        case .telemetry:
            SettingsTelemetrySection(telemetryOptIn: $telemetryOptIn)
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
