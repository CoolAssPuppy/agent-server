import SwiftUI

extension SettingsDrawer {
    var resumeAfterWakeBinding: Binding<Bool> {
        Binding(
            get: { draft.resumeAfterWake },
            set: { value in
                persistChange { $0.setResumeAfterWake(value) }
            }
        )
    }

    var panelSendingBinding: Binding<Bool> {
        Binding(
            get: { draft.panelSettings.isSendingEnabled },
            set: { value in
                persistChange { _ = $0.setPanelSendingEnabled(value) }
            }
        )
    }

    var telemetryBinding: Binding<TelemetryProgressSettings> {
        Binding(
            get: { draft.telemetryProgress },
            set: { settings in
                persistChange { $0.setTelemetryProgress(settings) }
            }
        )
    }

    var invalidKeysBinding: Binding<Set<String>> {
        Binding(get: { draft.invalidKeys }, set: { _ in })
    }

    func runtimeBinding(_ keyPath: KeyPath<RuntimeSelection, Bool>) -> Binding<Bool> {
        Binding(
            get: { draft.runtimeSelection[keyPath: keyPath] },
            set: { value in
                let current = draft.runtimeSelection
                let selection = RuntimeSelection(
                    usesInstalledClaude: keyPath == \.usesInstalledClaude
                        ? value : current.usesInstalledClaude,
                    usesInstalledCodex: keyPath == \.usesInstalledCodex
                        ? value : current.usesInstalledCodex,
                    usesInstalledKimi: keyPath == \.usesInstalledKimi
                        ? value : current.usesInstalledKimi
                )
                persistChange { $0.setRuntimeSelection(selection) }
            }
        )
    }

    func loadPairs(from url: URL) {
        do {
            draft.replaceLoadedPairs(try EnvFileStore.load(from: url))
        } catch {
            draft.replaceLoadedPairs([])
            draft.recordLoadFailure(
                fileName: url.lastPathComponent,
                description: error.localizedDescription
            )
        }
    }

    func persistEnvironmentDraft() {
        do {
            try EnvFileStore.save(try draft.validatedPairs(), to: workspace.environmentFile)
            draft.clearError()
        } catch {
            draft.recordPersistenceFailure(error)
        }
    }

    private func persistChange(_ change: (inout SettingsDraft) -> Void) {
        draft.persistChange(change) { pairs in
            try EnvFileStore.save(pairs, to: workspace.environmentFile)
        }
    }

    func restartForRuntimeChange() {
        draft.acknowledgeRuntimeRestart()
        monitor.requestServerRestart()
    }

    func restartForGeneralChange() {
        draft.acknowledgeGeneralRestart()
        monitor.requestServerRestart()
    }

    func restartForPanelChange() {
        draft.acknowledgePanelRestart()
        monitor.requestServerRestart()
    }

    func chooseWorkspace() {
        guard let url = SettingsWorkspaceActions.choose(current: workspace) else { return }
        AgentServerWorkspaceStore.setHomeDirectory(url)
        workspace = AgentServerWorkspace(homeDirectory: url)
        reloadAfterWorkspaceChange()
    }

    func restoreDefaultWorkspace() {
        AgentServerWorkspaceStore.restoreDefault()
        workspace = .default()
        reloadAfterWorkspaceChange()
    }

    func reloadAfterWorkspaceChange() {
        workspaceReloadTask?.cancel()
        let generation = draft.beginWorkspaceReload()
        let environmentFile = workspace.environmentFile
        monitor.workspaceDidChange()
        workspaceReloadTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(3))
            } catch {
                return
            }
            do {
                let pairs = try EnvFileStore.load(from: environmentFile)
                guard draft.applyReloadedPairs(pairs, generation: generation) else { return }
            } catch {
                guard draft.acceptsWorkspaceReload(generation: generation) else { return }
                draft.recordLoadFailure(
                    fileName: environmentFile.lastPathComponent,
                    description: error.localizedDescription
                )
            }
            monitor.poll()
        }
    }
}
