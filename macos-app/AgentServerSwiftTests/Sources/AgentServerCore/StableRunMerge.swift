import Foundation

enum StableRunMerge {
    static func merge<Value>(
        panel: [Value],
        local: [Value],
        id: KeyPath<Value, String>,
        isActive: KeyPath<Value, Bool>
    ) -> [Value] {
        var localByID: [String: Value] = [:]
        var localIDOrder: [String] = []
        for run in local {
            let runID = run[keyPath: id]
            if localByID[runID] == nil {
                localIDOrder.append(runID)
            }
            localByID[runID] = run
        }

        let panelIDs = Set(panel.map { $0[keyPath: id] })
        var claimedPanelIDs = Set<String>()
        let mergedPanel = panel.map { panelRun in
            let runID = panelRun[keyPath: id]
            guard claimedPanelIDs.insert(runID).inserted,
                  panelRun[keyPath: isActive],
                  let localRun = localByID[runID] else {
                return panelRun
            }
            return localRun
        }

        let localOnly = localIDOrder.compactMap { runID in
            panelIDs.contains(runID) ? nil : localByID[runID]
        }
        return localOnly + mergedPanel
    }
}
