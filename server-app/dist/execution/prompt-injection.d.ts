export type PromptInjectionAssessment = {
    suspicious: boolean;
    score: number;
    reasons: string[];
};
export declare function assessPromptInjectionRisk(input: string): PromptInjectionAssessment;
export declare function wrapUntrustedUserContext(input: string): string;
//# sourceMappingURL=prompt-injection.d.ts.map