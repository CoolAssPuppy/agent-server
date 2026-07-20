# NerdsUI compatibility module

This small module is independently implemented from Agent Server public call sites. It provides only the design tokens, palette contract, color parser, and SwiftUI theme environment that Agent Server imports.

No source from the private NerdsUI repository is included. The `NerdsUI` module and product names are retained as a compatibility boundary so the application does not need a broad import rewrite.

Keep the API limited to symbols used by Agent Server. Add behavior tests before extending it.
