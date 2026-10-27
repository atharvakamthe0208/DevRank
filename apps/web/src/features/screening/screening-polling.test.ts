import { describe, expect, it, vi } from 'vitest';
import { pollScreeningUntilSettled } from './screening-polling';

describe('pollScreeningUntilSettled', () => {
  it('fetches until a processing session reaches a terminal state', async () => {
    const fetchLatest = vi.fn()
      .mockResolvedValueOnce({ status: 'processing', revision: 2 })
      .mockResolvedValueOnce({ status: 'completed', revision: 3 });
    const onUpdate = vi.fn();
    const result = await pollScreeningUntilSettled({ status: 'processing', revision: 1 }, fetchLatest, {
      wait: vi.fn().mockResolvedValue(undefined), onUpdate,
    });

    expect(result).toEqual({ status: 'completed', revision: 3 });
    expect(fetchLatest).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenNthCalledWith(1, { status: 'processing', revision: 2 });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { status: 'completed', revision: 3 });
  });

  it('stops after its bound while preserving processing status', async () => {
    const fetchLatest = vi.fn().mockResolvedValue({ status: 'processing' });
    const result = await pollScreeningUntilSettled({ status: 'processing' }, fetchLatest, {
      wait: vi.fn().mockResolvedValue(undefined), maxAttempts: 3,
    });
    expect(result).toEqual({ status: 'processing' });
    expect(fetchLatest).toHaveBeenCalledTimes(3);
  });

  it('preserves failed status, propagates fetch errors, and stops after cancellation', async () => {
    const failed = vi.fn().mockResolvedValue({ status: 'failed' });
    await expect(pollScreeningUntilSettled({ status: 'processing' }, failed, {
      wait: vi.fn().mockResolvedValue(undefined),
    })).resolves.toEqual({ status: 'failed' });
    const broken = vi.fn().mockRejectedValue(new Error('retrieval failed'));
    await expect(pollScreeningUntilSettled({ status: 'processing' }, broken, {
      wait: vi.fn().mockResolvedValue(undefined),
    })).rejects.toThrow('retrieval failed');
    const cancelled = vi.fn();
    await expect(pollScreeningUntilSettled({ status: 'processing' }, cancelled, {
      wait: vi.fn().mockResolvedValue(undefined), isCurrent: () => false,
    })).resolves.toBeNull();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
