/**
 * 日记同步的「闸门」。
 *
 * 同步失败最常见的原因是网络断/服务端 5xx，这类失败重试再多次也是立刻失败，
 * 但如果每 10 分钟、每次回前台、每次下拉刷新都重新跑一遍完整推送，就会一直
 * 占着 JS 线程做加密和请求，别的功能（命令、页面切换）跟着卡。
 *
 * 所以这里只做三件事：
 * 1. 同一时刻只允许一轮同步（single-flight）；
 * 2. 失败后按 1→2→5→10 分钟退避，退避期内自动触发直接跳过；
 * 3. 一串失败只提示一次，避免刷屏。
 *
 * 纯函数 + 一个很小的状态容器，方便单测。
 */

export const FAILURE_BACKOFF_MS = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];

/** 连续失败 n 次后，下一次自动同步要等多久。 */
export function backoffFor(failures: number): number {
  if (failures <= 0) {
    return 0;
  }
  const index = Math.min(failures, FAILURE_BACKOFF_MS.length) - 1;
  return FAILURE_BACKOFF_MS[index];
}

export class SyncGate {
  private failures = 0;
  private nextAllowedAt = 0;
  private notified = false;

  /** 自动触发（定时/回前台）是否还该等一会儿。 */
  blocked(now = Date.now()): boolean {
    return now < this.nextAllowedAt;
  }

  /** 距离下一次允许自动同步还有多少毫秒（已在允许期则为 0）。 */
  remaining(now = Date.now()): number {
    return Math.max(0, this.nextAllowedAt - now);
  }

  /** 连续失败次数。 */
  failureCount(): number {
    return this.failures;
  }

  /** 记录一次失败，返回是否应该给用户提示（一串失败只提示一次）。 */
  fail(now = Date.now()): boolean {
    this.failures += 1;
    this.nextAllowedAt = now + backoffFor(this.failures);
    if (this.notified) {
      return false;
    }
    this.notified = true;
    return true;
  }

  /** 记录一次成功：清空退避，并允许下一次失败再提示。 */
  ok(): void {
    this.failures = 0;
    this.nextAllowedAt = 0;
    this.notified = false;
  }

  /** 用户手动触发（下拉刷新）时放行，但仍然记一次尝试。 */
  allowManual(now = Date.now()): void {
    this.nextAllowedAt = now;
  }
}
