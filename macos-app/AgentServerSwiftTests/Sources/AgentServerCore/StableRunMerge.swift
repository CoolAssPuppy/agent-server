enum StableRunMerge {
    struct Revision: Equatable {
        let id: String
        let status: String
    }

    static func merge<Value>(
        panel: [Value]?,
        local: [Value],
        id: KeyPath<Value, String>,
        isActive: KeyPath<Value, Bool>
    ) -> [Value] {
        guard let panel else { return local }
        return merge(panel: panel, local: local, id: id, isActive: isActive)
    }

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
            guard localByID[runID] == nil else { continue }
            localIDOrder.append(runID)
            localByID[runID] = run
        }

        var panelIDs = Set<String>()
        let mergedPanel: [Value] = panel.compactMap { panelRun in
            let runID = panelRun[keyPath: id]
            guard panelIDs.insert(runID).inserted else { return nil }
            if panelRun[keyPath: isActive], let localRun = localByID[runID] {
                return localRun
            }
            return panelRun
        }

        let localOnly = localIDOrder.compactMap { runID in
            panelIDs.contains(runID) ? nil : localByID[runID]
        }
        return localOnly + mergedPanel
    }

    static func revision<Value>(
        _ values: [Value],
        id: KeyPath<Value, String>,
        status: (Value) -> String
    ) -> [Revision] {
        values.map { Revision(id: $0[keyPath: id], status: status($0)) }
    }
}
