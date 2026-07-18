# Lessons

- When a task asks for local Apple or macOS development guidance, inspect the
  project owner's dotfiles skill links as well as the session skill catalog
  before finalizing the implementation plan.
- For long implementation work, commit each consequential verified batch, then
  perform a simplification pass and rerun affected tests before starting the
  next milestone. Keep every production change tied to a failing behavior test.
- When adding a model-controlled CLI provider, audit the entire child environment. Removing one billing credential is insufficient because shell commands can inherit unrelated secrets.
- Provider support is not complete until filesystem, network, command, credential, and approval boundaries are stated and tested separately.
- Before deleting a generated-output directory, separate tracked assets from disposable artifacts with `git ls-files`. Preserve tracked metadata and images unless the user explicitly names them.
