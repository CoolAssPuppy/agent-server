export type TimeoutOptions = {
  timeoutMs?: number;
  createError: () => Error;
  onTimeout?: (error: Error) => void;
};

/** Races work against a deadline and always releases the timer. */
export async function withTimeout<T>(
  work: Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const { timeoutMs } = options;
  if (!timeoutMs || timeoutMs <= 0) return work;

  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      const error = options.createError();
      options.onTimeout?.(error);
      reject(error);
    }, timeoutMs);
    handle.unref?.();
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}
