import { Retry } from "./retry.js";

const noop = () => {};

Tinytest.add("retry - retryLater with count < minCount returns minTimeout", (test) => {
  const retry = new Retry({ minCount: 3, minTimeout: 42 });
  try {
    test.equal(retry.retryLater(0, noop), 42);
    retry.clear();
    test.equal(retry.retryLater(1, noop), 42);
    retry.clear();
    test.equal(retry.retryLater(2, noop), 42);
  } finally {
    retry.clear();
  }
});

Tinytest.add("retry - retryLater with count >= minCount respects fuzz bounds", (test) => {
  const retry = new Retry({
    baseTimeout: 1000,
    exponent: 2,
    fuzz: 0.5,
    minCount: 0,
    maxTimeout: 1e9,
  });

  // Unfuzzed value at count=2 is 1000 * 2^2 = 4000.
  // Fuzz factor: random * 0.5 + 0.75 ∈ [0.75, 1.25].
  // Admissible window: [3000, 5000].
  try {
    for (let i = 0; i < 20; i++) {
      const timeout = retry.retryLater(2, noop);
      retry.clear();
      test.isTrue(
        timeout >= 3000 && timeout <= 5000,
        `sample ${i}: expected [3000, 5000], got ${timeout}`,
      );
    }
  } finally {
    retry.clear();
  }
});

Tinytest.add("retry - retryLater caps at maxTimeout", (test) => {
  const retry = new Retry({
    maxTimeout: 100,
    baseTimeout: 1000,
    exponent: 10,
    fuzz: 0,
    minCount: 0,
  });
  try {
    // Unfuzzed value at count=5 is 1000 * 10^5 = 1e8, capped to 100.
    // With fuzz=0: factor is (random * 0 + 1) = 1. Result: 100.
    test.equal(retry.retryLater(5, noop), 100);
  } finally {
    retry.clear();
  }
});

Tinytest.addAsync("retry - retryLater actually fires the callback", async (test) => {
  const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
  await new Promise((resolve) => {
    retry.retryLater(0, resolve);
  });
  test.ok();
  retry.clear();
});

Tinytest.addAsync("retry - clear cancels pending callback", async (test) => {
  const retry = new Retry({ minCount: 1, minTimeout: 1000 });
  let fired = false;
  retry.retryLater(0, () => {
    fired = true;
  });
  retry.clear();

  await new Promise((resolve) => setTimeout(resolve, 50));
  test.isFalse(fired, "cancelled callback should not fire");
});

Tinytest.addAsync("retry - retryLater replaces pending timer", async (test) => {
  const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
  let firedFirst = false;
  let firedSecond = false;

  retry.retryLater(0, () => {
    firedFirst = true;
  });
  retry.retryLater(0, () => {
    firedSecond = true;
  });

  // Wait long enough that both timers would have fired if not cancelled.
  await new Promise((resolve) => setTimeout(resolve, 30));

  test.isFalse(firedFirst, "first callback should have been replaced");
  test.isTrue(firedSecond, "second callback should have fired");
  retry.clear();
});

Tinytest.add("retry - clear is idempotent", (test) => {
  const retry = new Retry();
  retry.clear();
  retry.clear();
  retry.clear();
  test.ok();
});

// A minimal AbortSignal stand-in that records listener bookkeeping, so the
// tests can check listener release without relying on engine internals.
const makeSignal = () => {
  const listeners = new Set();
  return {
    aborted: false,
    listeners,
    addEventListener(type, listener) {
      if (type === "abort") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    },
    abort() {
      if (this.aborted) return;
      this.aborted = true;
      [...listeners].forEach((listener) => listener());
    },
  };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

Tinytest.addAsync("retry - signal aborted before firing cancels the callback", async (test) => {
  const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
  const signal = makeSignal();
  let fired = false;
  const delay = retry.retryLater(0, () => (fired = true), { signal });
  test.equal(delay, 1);
  test.equal(signal.listeners.size, 1);

  signal.abort();
  test.equal(signal.listeners.size, 0, "abort releases the listener");

  await wait(30);
  test.isFalse(fired, "aborted callback should not fire");
  signal.abort();
  retry.clear();
});

Tinytest.addAsync(
  "retry - already aborted signal schedules nothing and replaces pending attempt",
  async (test) => {
    const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
    const firstSignal = makeSignal();
    let firedFirst = false;
    let firedSecond = false;
    retry.retryLater(0, () => (firedFirst = true), { signal: firstSignal });

    const aborted = makeSignal();
    aborted.aborted = true;
    test.equal(
      retry.retryLater(0, () => (firedSecond = true), { signal: aborted }),
      1,
    );
    test.equal(aborted.listeners.size, 0, "no listener on an already-aborted signal");
    test.equal(firstSignal.listeners.size, 0, "replaced attempt released its listener");

    await wait(30);
    test.isFalse(firedFirst, "previous attempt should be cancelled");
    test.isFalse(firedSecond, "already-aborted attempt should not fire");
  },
);

Tinytest.addAsync("retry - callback fires with a signal that is never aborted", async (test) => {
  const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
  const signal = makeSignal();
  await new Promise((resolve) => retry.retryLater(0, resolve, { signal }));
  test.equal(signal.listeners.size, 0, "completion releases the listener");
  retry.clear();
});

Tinytest.addAsync(
  "retry - aborting a replaced signal does not cancel the newer attempt",
  async (test) => {
    const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
    const oldSignal = makeSignal();
    const newSignal = makeSignal();
    let firedOld = false;
    let firedNew = false;
    retry.retryLater(0, () => (firedOld = true), { signal: oldSignal });
    retry.retryLater(0, () => (firedNew = true), { signal: newSignal });
    test.equal(oldSignal.listeners.size, 0, "replacement releases the old listener");

    oldSignal.abort();
    await wait(30);
    test.isFalse(firedOld, "replaced attempt should not fire");
    test.isTrue(firedNew, "newer attempt should still fire");
    retry.clear();
  },
);

Tinytest.addAsync(
  "retry - clear releases the abort listener and repeated abort/clear is safe",
  async (test) => {
    const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
    const signal = makeSignal();
    let fired = false;
    retry.retryLater(0, () => (fired = true), { signal });
    retry.clear();
    test.equal(signal.listeners.size, 0, "clear releases the listener");
    retry.clear();
    signal.abort();
    signal.abort();
    retry.clear();

    await wait(30);
    test.isFalse(fired);
  },
);

Tinytest.addAsync(
  "retry - callback that reschedules keeps its new timer and listener",
  async (test) => {
    // count 0 waits minTimeout (1ms); count 1 waits baseTimeout * exponent = 50ms.
    const retry = new Retry({ minCount: 1, minTimeout: 1, baseTimeout: 50, exponent: 1, fuzz: 0 });
    const firstSignal = makeSignal();
    const secondSignal = makeSignal();
    let firedSecond = false;
    let resolveFirst;
    const firstRan = new Promise((resolve) => (resolveFirst = resolve));

    retry.retryLater(
      0,
      () => {
        retry.retryLater(1, () => (firedSecond = true), { signal: secondSignal });
        // Aborting the first signal after its callback began must not touch
        // the attempt the callback just scheduled.
        firstSignal.abort();
        resolveFirst();
      },
      { signal: firstSignal },
    );

    await firstRan;
    test.equal(firstSignal.listeners.size, 0, "started attempt released its listener");
    test.equal(secondSignal.listeners.size, 1, "rescheduled attempt keeps its listener");
    await wait(100);
    test.isTrue(firedSecond, "rescheduled attempt should fire");
    test.equal(secondSignal.listeners.size, 0);
    retry.clear();
  },
);

Tinytest.addAsync("retry - works with a real AbortController", async (test) => {
  if (typeof AbortController === "undefined") {
    test.ok();
    return;
  }
  const retry = new Retry({ minCount: 1, minTimeout: 1, fuzz: 0 });
  const controller = new AbortController();
  let fired = false;
  const delay = retry.retryLater(0, () => (fired = true), { signal: controller.signal });
  controller.abort();
  test.equal(delay, 1);
  await wait(30);
  test.isFalse(fired, "aborted callback should not fire");
  retry.clear();
});
