import SwiftUI
import AgentServerDesignSystem

extension GuidedAgentCreationView {
    @ViewBuilder
    var questionStep: some View {
        if !model.flow.connectionQuestions.isEmpty {
            connectionSetupStep
        } else if let question = model.flow.nextQuestion {
            ConsumerFlowHeader(
                title: question.prompt,
                explanation: question.kind == .fileAccess
                    ? CreationFileAccessStepCopy.explanation
                    : nil
            )
            questionControl(question)
        }
    }

    var connectionSetupStep: some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(
                title: CreationConnectionStepCopy.title,
                explanation: CreationConnectionStepCopy.explanation
            )
            ForEach(model.flow.connectionQuestions) { question in
                if case .service(let serviceName, let choices) = question.kind {
                    serviceChoice(question, serviceName: serviceName, choices: choices)
                }
            }
            HStack {
                Spacer()
                Button("Set up later", action: deferConnectionSetup)
                    .buttonStyle(.borderless)
                    .controlSize(.small)
                    .accessibilityIdentifier(ConsumerFlowAccessibility.creationSetUpLater)
            }
        }
    }

    @ViewBuilder
    func questionControl(_ question: CreationQuestion) -> some View {
        switch question.kind {
        case .text:
            TextField("Type your answer", text: $model.answer)
                .textFieldStyle(.roundedBorder)
        case .folder:
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                HStack {
                    Text(model.answer.isEmpty ? "No folder selected" : model.answer)
                        .foregroundStyle(
                            model.answer.isEmpty
                                ? theme.tokens.mutedForeground
                                : theme.tokens.foreground
                        )
                        .lineLimit(1)
                    Spacer()
                    Button("Choose folder") { presentResourcePicker(.folder) }
                        .accessibilityIdentifier(ConsumerFlowAccessibility.creationFolderPicker)
                }
                pickerFailure
            }
        case .fileAccess:
            fileAccessPicker
        case .runtime(let options):
            RuntimeChoicePicker(options: options, selection: $model.answer)
        case .schedule:
            ScheduleField(draft: scheduleBinding)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Choose when this agent runs")
        case .choice(let choices):
            choiceControl(question, choices: choices)
        case .service(let serviceName, let choices):
            serviceChoice(question, serviceName: serviceName, choices: choices)
        case .confirmation:
            Picker("Choose one", selection: $model.answer) {
                Text("Choose…").tag("")
                Text("Yes").tag("Yes")
                Text("No").tag("No")
            }
        case .unavailable(let message):
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Label("No access was added", systemImage: "exclamationmark.triangle")
                Text(message)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                Button("Edit request") { model.returnToRequest() }
            }
        }
    }

    @ViewBuilder
    func choiceControl(_ question: CreationQuestion, choices: [String]) -> some View {
        if let resource = question.unavailableNativeResource {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                Label(resource.unavailableTitle, systemImage: resource.systemImage)
                Text(resource.recoveryMessage)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                HStack {
                    Button("Allow access") { requestNativeAccess(resource) }
                        .buttonStyle(.borderedProminent)
                    Button("Open System Settings") { openPrivacySettings(for: resource) }
                    Button("Check again", action: refreshQuestion)
                }
            }
        } else {
            Picker("Choose one", selection: $model.answer) {
                Text("Choose…").tag("")
                ForEach(Array(choices.enumerated()), id: \.offset) { index, label in
                    Text(label).tag(
                        index < question.choiceValues.count
                            ? question.choiceValues[index]
                            : label
                    )
                }
            }
        }
    }

    func serviceChoice(
        _ question: CreationQuestion,
        serviceName: String?,
        choices: [String]
    ) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            HStack(alignment: .top, spacing: NSpacing.md) {
                serviceBrandIcon(serviceName)
                VStack(alignment: .leading, spacing: NSpacing.xxs) {
                    if let title = question.serviceContextTitle {
                        Text(title).font(NTypography.headlineSmall)
                    }
                    if let explanation = question.serviceContextExplanation {
                        Text(explanation)
                            .font(NTypography.caption)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            VStack(spacing: NSpacing.xs) {
                if choices.isEmpty {
                    Button(
                        "Set up \(serviceName ?? "this app or service")",
                        action: requestConnectionSetup
                    )
                    .buttonStyle(.borderedProminent)
                } else {
                    ForEach(Array(choices.enumerated()), id: \.offset) { index, label in
                        let value = index < question.choiceValues.count
                            ? question.choiceValues[index]
                            : label
                        serviceChoiceRow(
                            questionId: question.id,
                            label: label,
                            value: value
                        )
                    }
                }
            }
        }
        .padding(.vertical, NSpacing.sm)
    }

    func serviceChoiceRow(questionId: String, label: String, value: String) -> some View {
        let isSelected = model.flow.answers[questionId] == .string(value)
        return Button {
            model.answer(questionId: questionId, value: value)
        } label: {
            HStack(spacing: NSpacing.sm) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(
                        isSelected ? theme.tokens.primary : theme.tokens.mutedForeground
                    )
                Text(label)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
                Spacer()
                Text("Connected")
                    .font(NTypography.captionSmall)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .padding(NSpacing.md)
            .background(isSelected ? theme.tokens.primary.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    func serviceBrandIcon(_ serviceName: String?) -> some View {
        Group {
            if let serviceName, let asset = CapabilityBrand.asset(forServiceName: serviceName) {
                Image(asset)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(theme.tokens.foreground)
                    .padding(6)
            } else {
                Image(systemName: "app.connected.to.app.below.fill")
                    .foregroundStyle(theme.tokens.foreground)
            }
        }
        .frame(width: 36, height: 36)
        .accessibilityHidden(true)
    }

    var scheduleBinding: Binding<ScheduleDraft> {
        Binding(
            get: { ScheduleDraft(cron: model.scheduleCron) },
            set: { model.scheduleCron = $0.cronExpression }
        )
    }
}
