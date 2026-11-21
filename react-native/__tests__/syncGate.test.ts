import {backoffFor, FAILURE_BACKOFF_MS, SyncGate} from '../src/sync/syncGate';

describe('backoffFor', () => {
  it('第一次失败等 1 分钟，之后逐步拉长到 10 分钟封顶', () => {
    expect(backoffFor(0)).toBe(0);
    expect(backoffFor(1)).toBe(FAILURE_BACKOFF_MS[0]);
    expect(backoffFor(2)).toBe(FAILURE_BACKOFF_MS[1]);
    expect(backoffFor(3)).toBe(FAILURE_BACKOFF_MS[2]);
    expect(backoffFor(4)).toBe(FAILURE_BACKOFF_MS[3]);
    // 再失败也不会超过上限
    expect(backoffFor(9)).toBe(FAILURE_BACKOFF_MS[3]);
  });
});

describe('SyncGate', () => {
  it('失败后进入退避期，到期前自动触发被挡掉', () => {
    const gate = new SyncGate();
    const now = 1_000_000;
    expect(gate.blocked(now)).toBe(false);

    gate.fail(now);
    expect(gate.failureCount()).toBe(1);
    expect(gate.blocked(now + 30_000)).toBe(true);
    expect(gate.remaining(now + 30_000)).toBe(30_000);
    // 退避结束后放行
    expect(gate.blocked(now + FAILURE_BACKOFF_MS[0])).toBe(false);
    expect(gate.remaining(now + FAILURE_BACKOFF_MS[0])).toBe(0);
  });

  it('连续失败只提示一次，失败越多退避越久', () => {
    const gate = new SyncGate();
    const now = 5_000_000;
    expect(gate.fail(now)).toBe(true);
    expect(gate.fail(now)).toBe(false);
    expect(gate.fail(now)).toBe(false);
    expect(gate.failureCount()).toBe(3);
    expect(gate.remaining(now)).toBe(FAILURE_BACKOFF_MS[2]);
  });

  it('成功会清空退避和「已提示」标记', () => {
    const gate = new SyncGate();
    const now = 9_000_000;
    gate.fail(now);
    gate.ok();
    expect(gate.failureCount()).toBe(0);
    expect(gate.blocked(now)).toBe(false);
    // 下一次失败又能提示
    expect(gate.fail(now)).toBe(true);
  });

  it('手动触发可以立刻放行，但不清空失败计数', () => {
    const gate = new SyncGate();
    const now = 2_000_000;
    gate.fail(now);
    expect(gate.blocked(now + 1_000)).toBe(true);
    gate.allowManual(now + 1_000);
    expect(gate.blocked(now + 1_000)).toBe(false);
    expect(gate.failureCount()).toBe(1);
  });
});
