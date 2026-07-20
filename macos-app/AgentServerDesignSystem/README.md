# Agent Server design system

This small module is independently implemented from Agent Server public call sites. It provides only the design tokens, palette contract, color parser, and SwiftUI theme environment that Agent Server uses.

The package is owned by Agent Server and contains no source from private repositories. Keep its API limited to symbols used by the app, and add behavior tests before extending it.
