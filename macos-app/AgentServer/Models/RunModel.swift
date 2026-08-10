import Foundation
import SwiftUI
import AgentServerDesignSystem

// The wire models themselves live in AgentServerCore (WireModels.swift) so
// contract tests can decode the checked-in fixtures with the shipped types.

extension RunStatus {
    /// Theme-token color for this status, so status colors track the active
    /// theme instead of hardcoded system colors (the app is multi-theme).
    func color(_ tokens: ColorTokens) -> Color {
        switch self {
        case .running: return tokens.warning
        case .completed: return tokens.success
        case .failed: return tokens.destructive
        case .skipped: return tokens.mutedForeground
        }
    }
}
