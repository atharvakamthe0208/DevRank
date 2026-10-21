import { describe, expect, it, vi } from 'vitest';
import { drainScreeningQueue } from '../src/modules/screening/worker.js';

describe('screening worker queue draining', () => {
  it.each([1, 4, 5, 10, 20])('drains all %i queued resumes in bounded claims', async (count) => {
    const jobs = Array.from({ length: count }, (_, id) => id);
    const claimed: number[] = [];
    const processOne = vi.fn(async (job: number) => { claimed.push(job); });
    await drainScreeningQueue(async (limit) => jobs.splice(0, limit), processOne, 2);
    expect(claimed).toHaveLength(count);
    expect(new Set(claimed).size).toBe(count);
    expect(processOne).toHaveBeenCalledTimes(count);
  });

  it('continues through the queue when one resume processing task rejects', async () => {
    const completed: number[] = [];
    const jobs = [0, 1, 2, 3, 4];
    await drainScreeningQueue(async (limit) => jobs.splice(0, limit), async (job) => {
      if (job === 2) throw new Error('one resume failed');
      completed.push(job);
    }, 2);
    expect(completed).toEqual([0, 1, 3, 4]);
  });
});
