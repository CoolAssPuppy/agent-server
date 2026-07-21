import SwiftUI

extension SettingsDrawer {
    var resumeAfterWakeBinding: Binding<Bool> {
        Binding(
            get: { draft.resumeAfterWake },
            set: {
                draft.setResumeAfterWake($0)
                persistIfValid()
            }
        )
    }

    var panelSendingBinding: Binding<Bool> {
        Binding(
            get: { draft.panelSettings.isSendingEnabled },
            set: {
                guard draft.setPanelSendingEnabled($0) else { return }
                persistIfValid()
            }
        )
    }

    var telemetryBinding: Binding<TelemetryProgressSettings> {
        Binding(
            get: { draft.telemetryProgress },
            set: {
                draft.setTelemetryProgress($0)
                persistIfValid()
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
                draft.setRuntimeSelection(selection)
                persistIfValid()
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

    func persistIfValid() {
        do {
            try EnvFileStore.save(try draft.validatedPairs(), to: workspace.environmentFile)
            draft.recordSaveSuccess()
        } catch let error as SettingsDraftError {
            draft.recordValidationFailure(error)
        } catch let error as EnvFileStoreError {
            draft.recordSaveFailure(error)
        } catch {
            draft.recordSaveFailure(description: error.localizedDescription)
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
        let generation = draft.beginWorkspaceReload()
        let environmentFile = workspace.environmentFile
        monitor.workspaceDidChange()
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            guard draft.acceptsWorkspaceReload(generation: generation) else { return }
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
