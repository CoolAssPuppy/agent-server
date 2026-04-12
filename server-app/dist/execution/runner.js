import { randomUUID } from 'crypto';
import { acquireLock, releaseLock } from './lockfile.js';
import { sanitizePromptSuffix } from '../server/security-utils.js';
import { assessPromptInjectionRisk, wrapUntrustedUserContext } from './prompt-injection.js';
export async function runAgent(options) {
    const { agent, lockDir, execute, createReporter, promptSuffix, conversationId } = options;
    if (!acquireLock(lockDir, agent.id)) {
        return { status: 'skipped' };
    }
    const runId = randomUUID();
    const reporter = createReporter(runId, agent.name, conversationId);
    const safePromptSuffix = promptSuffix ? sanitizePromptSuffix(promptSuffix) : undefined;
    const guardPromptInput = process.env.AGENT_SERVER_PROMPT_INJECTION_GUARD !== 'false';
    const strictPromptInput = process.env.AGENT_SERVER_PROMPT_INJECTION_STRICT === 'true';
    const injectionAssessment = safePromptSuffix
        ? assessPromptInjectionRisk(safePromptSuffix)
        : null;
    const contextualSuffix = safePromptSuffix
        ? guardPromptInput
            ? wrapUntrustedUserContext(safePromptSuffix)
            : safePromptSuffix
        : undefined;
    const effectiveAgent = contextualSuffix
        ? { ...agent, prompt: `${agent.prompt}\n\nUser context (sanitized):\n${contextualSuffix}` }
        : agent;
    try {
        await reporter.start();
        if (injectionAssessment?.suspicious) {
            await reporter.progress(`Security warning: suspicious user context detected (${injectionAssessment.reasons.join(', ')})`, {
                security_event: 'prompt_injection_suspected',
                score: injectionAssessment.score,
                reasons: injectionAssessment.reasons,
            });
            if (strictPromptInput) {
                throw new Error('Rejected suspicious prompt suffix by AGENT_SERVER_PROMPT_INJECTION_STRICT');
            }
        }
        const result = await execute(effectiveAgent, reporter);
        await reporter.complete(result);
        reporter.stop();
        return { runId, status: 'completed', result };
    }
    catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await reporter.fail(error);
        reporter.stop();
        return { runId, status: 'failed', error: error.message };
    }
    finally {
        releaseLock(lockDir, agent.id);
    }
}
//# sourceMappingURL=runner.js.map