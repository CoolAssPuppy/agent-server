import AgentServerDesignSystem
import SwiftUI

struct ScheduleField: View {
    @Binding var draft: ScheduleDraft
    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            HStack(spacing: NSpacing.sm) {
                Picker("", selection: $draft.frequency) {
                    ForEach(ScheduleDraft.Frequency.allCases) { option in
                        Text(option.rawValue).tag(option)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .frame(width: 150, alignment: .leading)

                if draft.frequency == .weekly {
                    Picker("", selection: $draft.weekday) {
                        ForEach(0..<7, id: \.self) { day in
                            Text(SchedulePreset.weekdayNames[day]).tag(day)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .frame(width: 130, alignment: .leading)
                }

                if showsTime {
                    Text("at")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                    DatePicker("", selection: $draft.time, displayedComponents: [.hourAndMinute])
                        .datePickerStyle(.field)
                        .labelsHidden()
                }
                Spacer()
            }

            if draft.frequency == .custom {
                TextField("Cron expression, e.g. */30 9-17 * * 1-5", text: $draft.customCron)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
            }
        }
    }

    private var showsTime: Bool {
        switch draft.frequency {
        case .daily, .weekdays, .weekly: true
        case .onDemand, .hourly, .custom: false
        }
    }
}
