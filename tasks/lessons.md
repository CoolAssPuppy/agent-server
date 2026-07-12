# Lessons

- When adding a model-controlled CLI provider, audit the entire child environment. Removing one billing credential is insufficient because shell commands can inherit unrelated secrets.
- Provider support is not complete until filesystem, network, command, credential, and approval boundaries are stated and tested separately.
- Before deleting a generated-output directory, separate tracked assets from disposable artifacts with `git ls-files`. Preserve tracked metadata and images unless the user explicitly names them.
