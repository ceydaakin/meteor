// Retry logic with an exponential backoff.
//
// options:
//  baseTimeout: time for initial reconnect attempt (ms).
//  exponent: exponential factor to increase timeout each attempt.
//  maxTimeout: maximum time between retries (ms).
//  minCount: how many times to reconnect "instantly".
//  minTimeout: time to wait for the first `minCount` retries (ms).
//  fuzz: factor to randomize retry times by (to avoid retry storms).

export class Retry {
  constructor({
    baseTimeout = 1000,
    exponent = 2.2,
    // The default is high-ish to ensure a server can recover from a
    // failure caused by load.
    maxTimeout = 5 * 60 * 1000,
    minTimeout = 10,
    minCount = 2,
    fuzz = 0.5,
  } = {}) {
    this.baseTimeout = baseTimeout;
    this.exponent = exponent;
    this.maxTimeout = maxTimeout;
    this.minTimeout = minTimeout;
    this.minCount = minCount;
    this.fuzz = fuzz;
    this.retryTimer = null;
    this._removeAbortListener = null;
  }

  // Reset a pending retry, if any.
  clear() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = null;
    this._releaseAbortListener();
  }

  _releaseAbortListener() {
    const remove = this._removeAbortListener;
    this._removeAbortListener = null;
    if (remove) remove();
  }

  // Calculate how long to wait in milliseconds to retry, based on the
  // `count` of which retry this is.
  _timeout(count) {
    if (count < this.minCount) {
      return this.minTimeout;
    }

    // fuzz the timeout randomly, to avoid reconnect storms when a
    // server goes down.
    const timeout =
      Math.min(this.maxTimeout, this.baseTimeout * Math.pow(this.exponent, count)) *
      (Random.fraction() * this.fuzz + (1 - this.fuzz / 2));

    return timeout;
  }

  // Call `fn` after a delay, based on the `count` of which retry this is.
  // Replaces any pending attempt. If `signal` (an AbortSignal) aborts before
  // `fn` starts, the attempt is cancelled; an already-aborted signal schedules
  // nothing. Returns the delay in milliseconds either way.
  retryLater(count, fn, { signal } = {}) {
    const timeout = this._timeout(count);
    this.clear();

    if (!signal) {
      this.retryTimer = Meteor.setTimeout(fn, timeout);
      return timeout;
    }
    if (signal.aborted) return timeout;

    const onAbort = () => this.clear();
    signal.addEventListener("abort", onAbort, { once: true });
    this._removeAbortListener = () => signal.removeEventListener("abort", onAbort);
    this.retryTimer = Meteor.setTimeout(() => {
      // Release before `fn` runs: a later abort must not undo a started
      // callback, and `fn` may schedule a new attempt with its own listener.
      this.retryTimer = null;
      this._releaseAbortListener();
      return fn();
    }, timeout);
    return timeout;
  }
}
