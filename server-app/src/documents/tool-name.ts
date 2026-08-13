/**
 * The tool's identity, kept in a module that imports nothing.
 *
 * The permission layer has to know this name to file the tool under the
 * path-checked tools, and the tool has to ask the permission layer whether a
 * path is granted. Holding the name here is what keeps those two from importing
 * each other.
 */
export const AGENT_DOCUMENT_SERVER_NAME = 'agent_documents';
export const AGENT_DOCUMENT_READ_TOOL_NAME = 'mcp__agent_documents__read_document';
