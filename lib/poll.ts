// Each effect owns its request and schedules the next read after completion.
export function poll(
  read: (signal: AbortSignal) => Promise<void>,
  interval: number | null,
  immediate = true,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  async function tick() {
    try {
      await read(controller.signal);
    } finally {
      if (!controller.signal.aborted && interval !== null)
        timer = setTimeout(tick, interval);
    }
  }
  if (immediate) void tick();
  else if (interval !== null) timer = setTimeout(tick, interval);
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
