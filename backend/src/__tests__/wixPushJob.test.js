import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub runPush before importing wixPushJob.
//
// We can't run the real Wix sync in unit tests (no API key, no Airtable),
// so the job manager gets exercised against a controlled stub. This lets
// us drive progress entries deterministically and assert the lifecycle
// transitions (running → done / partial / failed) and the single-flight
// rule (a second start while one is in flight returns the same jobId).
const runPushMock = vi.fn();
vi.mock('../services/wixProductSync.js', () => ({
  runPush: (onProgress) => runPushMock(onProgress),
}));

// Imported AFTER the mock so the module sees our stub.
const { startPushJob, getJob, _resetForTests } = await import('../services/wixPushJob.js');

function nextTick() {
  return new Promise(r => setImmediate(r));
}

describe('wixPushJob', () => {
  beforeEach(() => {
    _resetForTests();
    runPushMock.mockReset();
  });

  afterEach(() => {
    _resetForTests();
  });

  it('returns a jobId immediately and runs runPush in the background', async () => {
    let resolveRun;
    runPushMock.mockImplementation(() => new Promise(res => { resolveRun = res; }));

    const { jobId, alreadyRunning } = startPushJob();
    expect(jobId).toBeTruthy();
    expect(alreadyRunning).toBe(false);

    let job = getJob(jobId);
    expect(job.status).toBe('running');
    expect(job.log).toEqual([]);
    expect(job.result).toBeNull();

    resolveRun({ pricesSynced: 3, stockSynced: 0, categoriesSynced: 0, errors: [] });
    await nextTick();
    await nextTick();

    job = getJob(jobId);
    expect(job.status).toBe('done');
    expect(job.result.pricesSynced).toBe(3);
    expect(job.finishedAt).toBeGreaterThan(0);
  });

  it('captures progress entries appended via the onProgress callback', async () => {
    let progress;
    let resolveRun;
    runPushMock.mockImplementation((onProgress) => {
      progress = onProgress;
      return new Promise(res => { resolveRun = res; });
    });

    const { jobId } = startPushJob();
    progress({ kind: 'phase', message: 'Получаем данные из Wix...', level: 'info' });
    progress({ kind: 'item', message: 'Цена · Розы: 15zł → 18zł', level: 'info' });

    let job = getJob(jobId);
    expect(job.log).toHaveLength(2);
    expect(job.log[0].message).toBe('Получаем данные из Wix...');
    expect(job.log[0].at).toBeTypeOf('number');
    expect(job.log[1].kind).toBe('item');

    resolveRun({ pricesSynced: 1, stockSynced: 0, categoriesSynced: 0, errors: [] });
    await nextTick();
    await nextTick();
    job = getJob(jobId);
    expect(job.status).toBe('done');
  });

  it('marks the job partial when runPush returns errors', async () => {
    runPushMock.mockResolvedValue({
      pricesSynced: 2, stockSynced: 0, categoriesSynced: 0,
      errors: ['Price abc: timeout'],
    });

    const { jobId } = startPushJob();
    await nextTick();
    await nextTick();

    const job = getJob(jobId);
    expect(job.status).toBe('partial');
    expect(job.result.errors).toEqual(['Price abc: timeout']);
  });

  it('marks the job failed when runPush rejects', async () => {
    runPushMock.mockRejectedValue(new Error('Wix down'));

    const { jobId } = startPushJob();
    await nextTick();
    await nextTick();

    const job = getJob(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toBe('Wix down');
    // The failure also lands as a log entry so the modal can render it.
    const last = job.log[job.log.length - 1];
    expect(last.level).toBe('error');
    expect(last.message).toMatch(/Wix down/);
  });

  it('returns the same jobId for a second start while one is in flight', async () => {
    let resolveRun;
    runPushMock.mockImplementation(() => new Promise(res => { resolveRun = res; }));

    const first = startPushJob();
    const second = startPushJob();

    expect(second.jobId).toBe(first.jobId);
    expect(second.alreadyRunning).toBe(true);
    // runPush should only have been invoked once.
    expect(runPushMock).toHaveBeenCalledTimes(1);

    resolveRun({ pricesSynced: 0, stockSynced: 0, categoriesSynced: 0, errors: [] });
    await nextTick();
    await nextTick();
  });

  it('allows a brand-new job after the previous one finished', async () => {
    runPushMock.mockResolvedValue({ pricesSynced: 0, stockSynced: 0, categoriesSynced: 0, errors: [] });

    const first = startPushJob();
    await nextTick();
    await nextTick();
    expect(getJob(first.jobId).status).toBe('done');

    const second = startPushJob();
    expect(second.jobId).not.toBe(first.jobId);
    expect(second.alreadyRunning).toBe(false);
  });

  it('returns null from getJob for an unknown id', () => {
    expect(getJob('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
