import { toErrorMessage } from '../util/errors.js';

export type ManagedService = {
  name: string;
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
};

type StopManagedServices = () => Promise<void>;

type ManagedServicesOptions = {
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
};

async function runWithTimeout(
  operation: () => Promise<void> | void,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<void> {
  if (!timeoutMs || timeoutMs <= 0) {
    await operation();
    return;
  }

  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    handle.unref?.();
  });

  try {
    await Promise.race([Promise.resolve(operation()), timeout]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

async function stopServices(
  services: readonly ManagedService[],
  timeoutMs?: number,
): Promise<void> {
  const errors: Error[] = [];

  for (const service of [...services].reverse()) {
    try {
      await runWithTimeout(
        service.stop,
        timeoutMs,
        `${service.name} did not stop within ${timeoutMs}ms`,
      );
    } catch (error) {
      errors.push(new Error(`${service.name}: ${toErrorMessage(error)}`));
    }
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Multiple server services failed to stop');
}

/**
 * Starts resources in declaration order and returns an idempotent reverse-order
 * teardown. A service is included in rollback before its start is attempted so
 * partially initialized resources are also released.
 */
export async function startManagedServices(
  services: readonly ManagedService[],
  options: ManagedServicesOptions = {},
): Promise<StopManagedServices> {
  const attempted: ManagedService[] = [];

  try {
    for (const service of services) {
      attempted.push(service);
      await runWithTimeout(
        service.start,
        options.startTimeoutMs,
        `${service.name} did not start within ${options.startTimeoutMs}ms`,
      );
    }
  } catch (startError) {
    try {
      await stopServices(attempted, options.stopTimeoutMs);
    } catch (stopError) {
      throw new AggregateError(
        [startError, stopError],
        `Server startup failed: ${toErrorMessage(startError)}`,
      );
    }
    throw startError;
  }

  let hasStopped = false;
  return async () => {
    if (hasStopped) return;
    hasStopped = true;
    await stopServices(attempted, options.stopTimeoutMs);
  };
}
