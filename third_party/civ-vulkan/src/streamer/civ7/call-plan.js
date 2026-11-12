// Runs a host-prepared sequence of writes, native calls, copies and checks in one request.
// Values may come from memory the earlier steps wrote, so handles never cross the bridge.
// Shipped by toString(): everything it uses arrives through `native`.

/** @import {ConsoleNative, ConsoleRequest} from './console-runtime.js' */

/** @typedef {{args: string[], result: string, at: number, ms: number}} PlanCall */
/** @typedef {(calls: PlanCall[]) => void} PlanStep */

/**
 * @param {Pick<ConsoleNative, 'address' | 'integer' | 'argument' | 'checkMemory' | 'verified' | 'call' |
 *   'read32' | 'read64' | 'write32' | 'write64' | 'writeMemory' | 'readMemory' | 'fromHex' | 'toHex'>} native
 * @param {ConsoleRequest} request
 */
export function runCallPlan(native, request) {
  const {address, integer, argument, checkMemory, verified, call, read32, read64, write32, write64,
    writeMemory, readMemory, fromHex, toHex} = native;
  /** @param {bigint} value */
  const text = value => '0x' + value.toString(16);
  if (!Array.isArray(request.steps) || request.steps.length < 1 || request.steps.length > 512)
    throw Error('Invalid call plan');
  const reads = request.read || [];
  if (!Array.isArray(reads) || reads.length > 8) throw Error('Invalid call plan reads');

  /** @param {unknown} value */
  function width(value) {
    if (value !== 4 && value !== 8) throw Error('Invalid call plan width');
    return value;
  }

  /**
   * @param {unknown} value
   * @returns {() => bigint}
   */
  function source(value) {
    if (typeof value === 'string') {
      const literal = argument(value);
      return () => literal;
    }
    if (typeof value === 'number') {
      const literal = BigInt(integer(value, 0, Number.MAX_SAFE_INTEGER));
      return () => literal;
    }
    if (!value || typeof value !== 'object') throw Error('Invalid call plan value');
    const entry = /** @type {ConsoleRequest} */ (value);
    const bytes = Object.hasOwn(entry, 'u32') ? 4 : 8;
    const pointer = address(bytes === 4 ? entry.u32 : entry.u64);
    /** @param {bigint} at */
    const load = at => bytes === 4 ? read32(at) : read64(at);
    if (entry.index === undefined) {
      checkMemory(pointer, bytes, 1);
      return () => load(pointer);
    }
    const index = source(entry.index);
    const stride = integer(entry.stride, bytes, 256);
    const limit = integer(entry.limit, 1, 256);
    checkMemory(pointer, stride * limit, 1);
    return () => {
      const position = index();
      if (position >= BigInt(limit)) throw Error('Call plan index out of range');
      return load(pointer + position * BigInt(stride));
    };
  }

  /** @param {unknown} value */
  function bound(value) {
    return value === undefined ? null : source(value);
  }

  /**
   * @param {ConsoleRequest} step
   * @returns {PlanStep}
   */
  function compile(step) {
    if (step.write !== undefined) {
      const pointer = address(step.write);
      const bytes = fromHex(step.hex);
      if (!bytes.length) throw Error('Empty call plan write');
      checkMemory(pointer, bytes.length, 3);
      return () => writeMemory(pointer, bytes);
    }

    if (step.call !== undefined) {
      const pointer = address(step.call);
      if (!verified.has(text(pointer))) throw Error('Native function was not verified');
      if (!Array.isArray(step.args) || step.args.length > 6) throw Error('Invalid native call arguments');
      if (![undefined, 'vk', 'zero'].includes(/** @type {string | undefined} */ (step.expect)))
        throw Error('Invalid call expectation');
      const args = step.args.map(source);
      const store = step.store === undefined ? null : address(step.store);
      if (store !== null) checkMemory(store, 8, 3);
      const name = String(step.name || text(pointer)).slice(0, 128);
      return calls => {
        const values = args.map(value => value());
        const started = Date.now();
        const result = BigInt.asUintN(64, call(pointer, ...values));
        calls.push({args: values.map(text), result: text(result), at: started - begun, ms: Date.now() - started});
        if (store !== null) write64(store, result);
        if (step.expect === 'vk' && (result & 0xffffffffn) !== 0n)
          throw Error(name + ': VkResult ' + Number(BigInt.asIntN(32, result)));
        if (step.expect === 'zero' && result !== 0n) throw Error(String(step.message || name + ' failed'));
      };
    }

    if (step.copy !== undefined) {
      const value = source(step.copy);
      const pointer = address(step.to);
      const bytes = width(step.width);
      checkMemory(pointer, bytes, 3);
      return () => bytes === 4 ? write32(pointer, value() & 0xffffffffn) : write64(pointer, value());
    }

    if (step.check !== undefined) {
      const value = source(step.check);
      const equals = bound(step.equals);
      const minimum = bound(step.min);
      const maximum = bound(step.max);
      const below = bound(step.below);
      const mask = bound(step.mask);
      const message = String(step.message || 'Call plan check failed');
      return () => {
        const actual = value();
        if (step.allowZero && actual === 0n) return;
        const equalOk = !equals || actual === equals();
        const rangeOk = (!minimum || actual >= minimum()) && (!maximum || actual <= maximum());
        const belowOk = !below || actual < below();
        const maskOk = !mask || (actual & mask()) === mask();
        if (!equalOk || !rangeOk || !belowOk || !maskOk) throw Error(message);
      };
    }

    if (step.contains !== undefined) {
      const pointer = address(step.contains);
      const count = source(step.count);
      const bytes = width(step.width);
      const stride = integer(step.stride, bytes, 256);
      const limit = integer(step.limit, 1, 256);
      const wanted = source(step.equals);
      checkMemory(pointer, stride * limit, 1);
      const message = String(step.message || 'Call plan value missing');
      return () => {
        const entries = count();
        if (entries > BigInt(limit)) throw Error(message);
        for (let index = 0n; index < entries; index++) {
          const at = pointer + index * BigInt(stride);
          if ((bytes === 4 ? read32(at) : read64(at)) === wanted()) return;
        }
        throw Error(message);
      };
    }

    throw Error('Unknown call plan step');
  }

  const compiled = request.steps.map(compile);
  const ranges = reads.map((/** @type {ConsoleRequest} */ range) => {
    const pointer = address(range.address);
    const length = integer(range.length, 1, 0x1000);
    checkMemory(pointer, length, 1);
    return {pointer, length};
  });

  /** @type {PlanCall[]} */
  const calls = [];
  /** @type {{step: number, message: string} | null} */
  let error = null;
  const begun = Date.now();
  for (let index = 0; index < compiled.length; index++) {
    try {
      compiled[index](calls);
    } catch (failure) {
      error = {step: index, message: String(/** @type {{message?: unknown}} */ (failure).message || failure)};
      break;
    }
  }
  const elapsedMs = Date.now() - begun;

  return {calls, elapsedMs, ...(error ? {error} : {}),
    memory: ranges.map(range => toHex(readMemory(range.pointer, range.length)))};
}

/**
 * A step as the host records it; `call` is a function name until it is resolved to an address.
 * @typedef {{call?: string, [field: string]: unknown}} RecordedStep
 */

/**
 * A call-plan reply on the host, checked: one hex string per read range, one record per call
 * that ran, and the failing step when one threw.
 * @typedef {{memory: string[], calls: PlanCall[], elapsedMs: number,
 *   error?: {step: number, message: string}}} PlanReply
 */

/**
 * @param {import('./protocol.js').Civ7Frame} reply
 * @returns {PlanReply}
 */
export function planReply(reply) {
  const {memory, calls, elapsedMs, error} = reply;
  const memoryOk = Array.isArray(memory) && memory.every(text => typeof text === 'string');
  const callsOk = Array.isArray(calls) && calls.every(call => typeof call?.result === 'string');
  if (!memoryOk || !callsOk || typeof elapsedMs !== 'number') throw Error('Invalid call plan reply');

  const failure = /** @type {{step?: unknown, message?: unknown} | undefined} */ (error);
  if (failure !== undefined && (typeof failure.step !== 'number' || typeof failure.message !== 'string'))
    throw Error('Invalid call plan reply');

  return /** @type {PlanReply} */ (reply);
}
