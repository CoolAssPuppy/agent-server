import CoreGraphics

/// Axis a drawer can be dragged along to dismiss.
/// Leading drawers (AgentDetailDrawer) close when pulled LEFT (negative x).
/// Top drawers (SettingsDrawer) close when pulled DOWN (positive y).
public enum DrawerDismissAxis {
    /// Dismisses when translation is <= -threshold (drag leftward).
    case horizontalLeading
    /// Dismisses when translation is >= +threshold (drag downward).
    case vertical
}

/// Pure helper used by a drawer's DragGesture.onEnded to decide whether
/// to animate the drawer closed or snap it back to its open position.
///
/// Extracted so the logic can be unit-tested without SwiftUI.
public func shouldDismissOnRelease(
    translation: CGFloat,
    threshold: CGFloat,
    axis: DrawerDismissAxis = .horizontalLeading
) -> Bool {
    switch axis {
    case .horizontalLeading:
        return translation <= -threshold
    case .vertical:
        return translation >= threshold
    }
}
