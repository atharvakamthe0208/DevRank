export type PollableScreening = { status: string };

export async function pollScreeningUntilSettled<T extends PollableScreening>(
  initial: T,
  fetchLatest: () => Promise<T>,
  options: {
    wait: () => Promise<void>;
    maxAttempts?: number;
    isCurrent?: () => boolean;
    onUpdate?: (value: T) => void;
  },
): Promise<T | null> {
  const maxAttempts = options.maxAttempts ?? 10;
  let current = initial;
  for (let attempt = 0; current.status === 'processing' && attempt < maxAttempts; attempt += 1) {
    await options.wait();
    if (options.isCurrent && !options.isCurrent()) return null;
    current = await fetchLatest();
    options.onUpdate?.(current);
  }
  return options.isCurrent && !options.isCurrent() ? null : current;
}
