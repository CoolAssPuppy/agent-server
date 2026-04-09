import Foundation

protocol MCPHandler {
    func tools() -> [MCPTool]
    func call(name: String, arguments: [String: Any]) throws -> String
}

struct MCPTool {
    let name: String
    let description: String
    let inputSchema: [String: Any]
}

enum MCPError: Error, LocalizedError {
    case invalidParams(String)
    case methodNotFound(String)
    case toolFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidParams(let msg): return msg
        case .methodNotFound(let method): return "Method not found: \(method)"
        case .toolFailed(let msg): return msg
        }
    }
}

final class MCPServer {
    private let handler: MCPHandler
    private let stdout = FileHandle.standardOutput
    private let stderr = FileHandle.standardError

    init(handler: MCPHandler) {
        self.handler = handler
    }

    func run() {
        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            handleLine(trimmed)
        }
    }

    private func handleLine(_ line: String) {
        guard let data = line.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            logError("Failed to parse JSON: \(line)")
            return
        }

        let id = json["id"]
        let method = json["method"] as? String ?? ""
        let params = json["params"] as? [String: Any] ?? [:]

        if id == nil {
            return
        }

        do {
            let result = try dispatch(method: method, params: params)
            sendResponse(id: id!, result: result)
        } catch let MCPError.methodNotFound(method) {
            sendError(id: id!, code: -32601, message: "Method not found: \(method)")
        } catch let MCPError.invalidParams(msg) {
            sendError(id: id!, code: -32602, message: msg)
        } catch {
            sendError(id: id!, code: -32603, message: error.localizedDescription)
        }
    }

    private func dispatch(method: String, params: [String: Any]) throws -> [String: Any] {
        switch method {
        case "initialize":
            return [
                "protocolVersion": "2024-11-05",
                "capabilities": ["tools": [String: Any]()],
                "serverInfo": [
                    "name": "agent-server-eventkit",
                    "version": "0.1.0"
                ]
            ]

        case "tools/list":
            let toolList: [[String: Any]] = handler.tools().map { tool in
                [
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.inputSchema
                ]
            }
            return ["tools": toolList]

        case "tools/call":
            guard let name = params["name"] as? String else {
                throw MCPError.invalidParams("missing tool name")
            }
            let args = params["arguments"] as? [String: Any] ?? [:]

            do {
                let text = try handler.call(name: name, arguments: args)
                return [
                    "content": [["type": "text", "text": text]]
                ]
            } catch {
                return [
                    "content": [["type": "text", "text": "Error: \(error.localizedDescription)"]],
                    "isError": true
                ]
            }

        default:
            throw MCPError.methodNotFound(method)
        }
    }

    private func sendResponse(id: Any, result: [String: Any]) {
        send([
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        ])
    }

    private func sendError(id: Any, code: Int, message: String) {
        send([
            "jsonrpc": "2.0",
            "id": id,
            "error": ["code": code, "message": message]
        ])
    }

    private func send(_ json: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: json, options: []) else {
            logError("Failed to serialize response")
            return
        }
        stdout.write(data)
        stdout.write(Data([0x0A]))
    }

    private func logError(_ message: String) {
        if let data = "[agent-server-eventkit] \(message)\n".data(using: .utf8) {
            stderr.write(data)
        }
    }
}
