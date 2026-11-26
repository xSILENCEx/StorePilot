import assert from "node:assert/strict";
import test from "node:test";
import { poll } from "../lib/poll";

test("慢请求完成后才安排下一次轮询，关闭后取消请求与定时器", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const first = Promise.withResolvers<void>();
  let calls = 0;
  let lastSignal: AbortSignal | undefined;
  const stop = poll(async (signal) => {
    lastSignal = signal;
    calls++;
    if (calls === 1) await first.promise;
  }, 100);
  t.mock.timers.tick(300);
  assert.equal(calls, 1);
  first.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(100);
  assert.equal(calls, 2);
  stop();
  assert.ok(lastSignal?.aborted);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(300);
  assert.equal(calls, 2);
});
