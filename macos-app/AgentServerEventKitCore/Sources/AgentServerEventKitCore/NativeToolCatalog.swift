import Foundation

public struct NativeTool {
    public let name: String
    public let description: String
    public let inputSchema: [String: Any]

    init(name: String, description: String, inputSchema: [String: Any]) {
        self.name = name
        self.description = description
        self.inputSchema = inputSchema
    }
}

public struct NativeToolCatalog {
    private let pagination: PaginationPolicy

    public init(pagination: PaginationPolicy = .nativeData) {
        self.pagination = pagination
    }

    public var tools: [NativeTool] {
        [
            tool("list_calendars", "List all available calendars with their titles and identifiers."),
            tool("list_events", "List calendar events within a date range.", properties: paginated([
                "start": string("ISO 8601 start date/time"),
                "end": string("ISO 8601 end date/time"),
                "calendar": string("Optional calendar title to filter by"),
                "calendarId": string("Selected calendar identifier"),
            ]), required: ["start", "end"]),
            tool("create_event", "Create a new calendar event. Returns the event id.", properties: [
                "title": string(), "start": string(), "end": string(), "calendar": string(),
                "calendarId": string(), "location": string(), "notes": string(), "isAllDay": boolean(),
            ], required: ["title", "start", "end"]),
            tool("update_event", "Update an existing calendar event by id.", properties: [
                "id": string(), "title": string(), "start": string(), "end": string(),
                "location": string(), "notes": string(), "isAllDay": boolean(),
            ], required: ["id"]),
            tool("delete_event", "Delete a calendar event by id.", properties: ["id": string()], required: ["id"]),
            tool("list_reminder_lists", "List all reminder lists with their titles and identifiers."),
            tool("list_reminders", "List reminders, optionally filtered by list and completion state.", properties: paginated([
                "list": string("Optional reminder list title"),
                "listId": string("Selected reminder list identifier"),
                "completed": boolean("Optional completion filter"),
            ])),
            tool("create_reminder", "Create a new reminder. Returns the reminder id.", properties: [
                "title": string(), "dueDate": string(), "list": string(), "listId": string(), "notes": string(),
            ], required: ["title"]),
            tool("complete_reminder", "Mark a reminder as completed by id.", properties: ["id": string()], required: ["id"]),
            tool("list_contacts", "List approved details for selected contacts.", properties: paginated([
                "groupId": string("Selected contact group identifier"),
            ])),
        ]
    }

    private func tool(
        _ name: String,
        _ description: String,
        properties: [String: Any] = [:],
        required: [String] = []
    ) -> NativeTool {
        var schema: [String: Any] = ["type": "object", "properties": properties]
        if !required.isEmpty { schema["required"] = required }
        return NativeTool(name: name, description: description, inputSchema: schema)
    }

    private func paginated(_ properties: [String: Any]) -> [String: Any] {
        var result = properties
        result["limit"] = [
            "type": "integer", "minimum": 1, "maximum": pagination.maximumLimit,
            "description": "Maximum records to return. Defaults to \(pagination.defaultLimit).",
        ]
        result["cursor"] = ["type": "string", "description": "Continuation cursor from a previous response"]
        return result
    }

    private func string(_ description: String? = nil) -> [String: Any] {
        property(type: "string", description: description)
    }

    private func boolean(_ description: String? = nil) -> [String: Any] {
        property(type: "boolean", description: description)
    }

    private func property(type: String, description: String?) -> [String: Any] {
        var result: [String: Any] = ["type": type]
        if let description { result["description"] = description }
        return result
    }
}
