export class ExecutorRegistry {
    executors = new Map();
    defaultName = null;
    register(name, executor) {
        this.executors.set(name, executor);
    }
    setDefault(name) {
        this.defaultName = name;
    }
    get(name) {
        const resolvedName = name ?? this.defaultName;
        if (!resolvedName)
            throw new Error('No default executor configured');
        const executor = this.executors.get(resolvedName);
        if (!executor)
            throw new Error(`Unknown executor: ${resolvedName}`);
        return executor;
    }
    resolve(agent) {
        return this.get(agent.executor);
    }
    list() {
        return [...this.executors.keys()];
    }
}
//# sourceMappingURL=executor-registry.js.map