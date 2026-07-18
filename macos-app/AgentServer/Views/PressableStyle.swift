import SwiftUI

/// Press feedback the Apple way: the surface reacts on pointer-DOWN, not on
/// release, with a critically-damped spring so it settles without bounce. A
/// press that carried no momentum should not overshoot. Honors Reduce Motion
/// by dropping the scale entirely (the highlight still conveys the press).
///
/// Usage: `.buttonStyle(PressableStyle())` on any Button. Pass a lighter or
/// firmer `scale` for large vs. small targets.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? scale : 1))
            .animation(
                // Response 0.3, critically damped: quick, no overshoot. This is
                // Apple's "drawer/sheet" family tuned for a press, not a flick.
                .spring(response: 0.3, dampingFraction: 1.0),
                value: configuration.isPressed
            )
    }
}

extension View {
    /// Spring-animates a value change unless the user asked for reduced motion,
    /// where it becomes an instant cut. One call site instead of scattering the
    /// `reduceMotion` check across every animated view.
    func springOr<V: Equatable>(
        reduceMotion: Bool,
        response: Double = 0.35,
        damping: Double = 0.9,
        value: V
    ) -> some View {
        animation(
            reduceMotion ? .none : .spring(response: response, dampingFraction: damping),
            value: value
        )
    }
}
