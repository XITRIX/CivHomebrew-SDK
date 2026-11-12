// The panel refresh rate through nnCompat's unnamed DisplaySession wrappers (354 reads, 301 sets),
// reached by a checked walk from the opened layer, and the layer's 1/rate extended swap interval on
// a raised panel. Limits and recovery in civ7/README.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import shippedTable from './compat-functions.json' with {type: 'json'};
import {planReply} from './call-plan.js';
import {replyArray, replyString} from './protocol.js';

/** @import {Civ7Rpc} from './transport.js' */
/** @import {Civ7Frame} from './protocol.js' */
/** @import {PlanReply} from './call-plan.js' */
/** @import {CompatTable} from './modules.js' */

/** The walk offsets below were read on this nnCompat build only (team notes t40-*, R15). */
export const WALK_MODULE_HASH = 'cf649bbd';

const WALK = {
  contextOwner: 0x48n,
  privateRecord: 0x30n,
  recordDispatch: 0x8n,
  recordKey: 0x10n,
  heldSession: 0x18n,
  sessionTransport: 0x10n,
  errorHook: 0x41401d0n
};

/** Context vtable slots and the module offsets they must point at. */
const SLOTS = [
  {label: 'display-open slot', slot: 0xc0n, offset: 0x2507f0n},
  {label: 'candidate slot', slot: 0x1e0n, offset: 0x252640n},
  {label: '301 slot', slot: 0x138n, unnamed: 'DisplaySession301'},
  {label: '354 slot', slot: 0x140n, unnamed: 'DisplaySession354'}
];

const FLAGS_60 = 1n;
const FLAGS_120 = 2n;
const BOTH_RATES = 3n;
const SET_120 = [2n, 2n];
const CLEAR_120 = [0n, 2n];
const SET_60 = [1n, 1n];

/**
 * The layer's swap interval bytes (enabled, interval, numerator u16, denominator u16) at +0xaa,
 * checked as the u64 at +0xa8, and the forwarding table the setter and clearer reach through two
 * PLT hops each (team notes t40-layer-rate-read.md, t37-next-step.md).
 */
const SWAP = {guard: 0xa8n, state: 0xaan, table: 0x404e108n, setSlot: 0x1f0n, clearSlot: 0x1f8n, lazy: 0x2bd1fc0n};
const SWAP_GOT = [
  {offset: 0x4048c60n, target: 0x25d3f0n}, {offset: 0x4048c68n, target: 0x25d400n},
  {offset: 0x4048a68n, target: 0x25b330n}, {offset: 0x4048a70n, target: 0x25b340n}
];
const SWAP_SET = '_ZN2nn2vi28SetLayerExtendedSwapIntervalEPNS0_5LayerEii';
const SWAP_CLEAR = '_ZN2nn2vi30ClearLayerExtendedSwapIntervalEPNS0_5LayerE';
const SWAP_CHAIN = [SWAP_SET, SWAP_CLEAR, '_ZN2nn2vi5Layer32SetLayerNextExtendedSwapIntervalEii',
  '_ZN2nn2vi5Layer34ClearLayerNextExtendedSwapIntervalEv',
  '_ZN2nn2vi6detail13InternalLayer27SetNextExtendedSwapIntervalEii',
  '_ZN2nn2vi6detail13InternalLayer29ClearNextExtendedSwapIntervalEv'];
const SWAP_UNNAMED = ['PltLayerSetNextSwap', 'PltLayerClearNextSwap', 'PltInternalSetNextSwap',
  'PltInternalClearNextSwap', 'SwapIntervalForwarder', 'SwapIntervalClearForwarder',
  'ExtendedSwapIntervalSetter', 'ExtendedSwapIntervalClearer'];
/** The layer default as the setter stores it; interval 1 alone is 1/60 s. */
const SWAP_STOCK = '000100000100';

/** The only panel mode above 60: 354 has bits for 60 and 120 only, none for 75 or 90. */
export const PANEL_RATES = [120];

/** Rates the device probe paces on the 120 Hz panel; 75 and 90 there are a swap pattern. */
export const PROBE_RATES = [75, 90, 120];

/** A target other than the panel's own rate must measure within this share of it. */
const RATE_TOLERANCE = 0.03;

/**
 * The six swap interval bytes the setter stores for 1/rate.
 * @param {number} rate
 */
function swapBytes(rate) {
  const bytes = Buffer.from('010101000000', 'hex');
  bytes.writeUInt16LE(rate, 4);
  return bytes.toString('hex');
}

const SWAP_SET_BYTES = PROBE_RATES.map(swapBytes);

const OUTPUT_BYTES = 8;
const GUARD_BYTES = 16;
const FILL = 'a5';
const ADDRESS_LIMIT = 1n << 39n;
const RECOVERY = 'reboot the console';

/** @param {bigint | number} value */
const hex = value => '0x' + BigInt(value).toString(16);

/** The flag word as the getter stores it, little-endian. */
const wordHex = (/** @type {bigint} */ value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.toString('hex');
};

/** @param {unknown} error */
const errorText = error => error instanceof Error ? error.message : String(error);

/**
 * @typedef {object} Walk Everything the plans check again and pass to the wrappers.
 * @property {bigint} base
 * @property {bigint} layer
 * @property {bigint} setter
 * @property {bigint} getter
 * @property {bigint} held
 * @property {bigint} key
 * @property {bigint} output
 * @property {{address: bigint, value: bigint, label: string}[]} checks
 */

/** @typedef {{walk: Walk | null, reason: string}} Preparation */

/** @typedef {{flags: bigint | null, result: number | null, reason: string}} FlagRead */

/** @typedef {{results: number[], flags: bigint | null, error: string | null}} PlanOutcome */

/** @typedef {PlanOutcome & {confirmed: boolean, polls: number, applyMs: number, presented: number}} Applied */

/**
 * @typedef {object} SwapChain The verified setter and clearer and the words their plans recheck.
 * @property {bigint} set
 * @property {bigint} clear
 * @property {bigint} layer
 * @property {{address: bigint, value: bigint, label: string}[]} checks
 */

/**
 * A lower applies after 301 returns, on a later present: 354 is polled every `intervalMs`, or
 * after each `present` batch when one is given, until `timeoutMs` of polling or presenting.
 */
const APPLY_WINDOW = {intervalMs: 20, timeoutMs: 1000};

/** A raise lands on a later present: measured batches may confirm it until this many ms after 301. */
const CONFIRM_WINDOW_MS = 2500;

/** Presents per second that prove a raised panel without 354: FIFO presents per vsync. */
const RAISED_HZ = 108;

/**
 * Whether a batch ran at the target: on the panel's own 120 at least RAISED_HZ (FIFO cannot go
 * faster), any other target within RATE_TOLERANCE either way.
 * @param {number} measuredHz
 * @param {number} rate
 */
function atRate(measuredHz, rate) {
  if (rate === 120) return measuredHz >= RAISED_HZ;

  return Math.abs(measuredHz - rate) <= rate * RATE_TOLERANCE;
}

/** @typedef {'raised' | 'pending' | 'failed'} RaiseState */

/**
 * @param {bigint} value
 * @param {string} label
 */
function pointer(value, label) {
  const valid = value > 0n && value < ADDRESS_LIMIT && value % 8n === 0n;
  if (!valid) throw Error('Invalid ' + label + ' pointer ' + hex(value));
  return value;
}

/**
 * One batch request of reads; each value is the u64 at its address, or the bytes when `length`
 * is given.
 * @param {Pick<Civ7Rpc, 'request'>} rpc
 * @param {{address: bigint, length?: number}[]} reads
 */
async function readBatch(rpc, reads) {
  const reply = await rpc.request({command: 'batch', commands: reads.map(item =>
    ({command: 'read', address: hex(item.address), length: item.length ?? 8}))});
  const replies = replyArray(reply, 'replies');
  if (replies.length !== reads.length) throw Error('Incomplete walk read');

  return replies.map(item => Buffer.from(replyString(/** @type {Civ7Frame} */ (item), 'hex'), 'hex'));
}

/**
 * @param {string} directory
 * @param {string} name
 */
async function readJson(directory, name) {
  return JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
}

/**
 * The flag word from the first read range, or null when the getter did not write it or wrote
 * past it.
 * @param {string | undefined} text
 */
function flagsFrom(text) {
  if (typeof text !== 'string' || text.length !== (OUTPUT_BYTES + GUARD_BYTES) * 2) return null;
  const bytes = Buffer.from(text, 'hex');
  const guardOk = bytes.subarray(OUTPUT_BYTES).every(value => value === 0xa5);
  const written = !bytes.subarray(0, OUTPUT_BYTES).every(value => value === 0xa5);
  if (!guardOk || !written) return null;

  return bytes.readBigUInt64LE();
}

/** A raise a title left behind: the 120 bit with nothing else beyond the two rates. */
const isLeftover = (/** @type {bigint} */ flags) => (flags & FLAGS_120) !== 0n && (flags & ~BOTH_RATES) === 0n;

/** 0x2 alone: with both rate bits 354's own decode keeps 60, so 0x3 waits for a measured batch. */
const isRaised = (/** @type {bigint | null} */ flags) => flags === FLAGS_120;

const isCleared = (/** @type {bigint | null} */ flags) => flags !== null && (flags & FLAGS_120) === 0n;

const isEnabled = (/** @type {bigint | null} */ flags) => flags !== null && flags !== 0n;

/** @param {PlanReply} reply @returns {PlanOutcome} */
function outcome(reply) {
  const results = reply.calls.map(call => Number(BigInt(call.result) & 0xffffffffn));
  const error = reply.error ? reply.error.message : null;
  const flags = error ? null : flagsFrom(reply.memory[0]);

  return {results, flags, error};
}

/** The six swap interval bytes from the u64 at layer +0xa8, hex. */
const swapState = (/** @type {bigint} */ word) => wordHex(word).slice(4);

/**
 * @param {Civ7Rpc} rpc
 * @param {{directory: string, table?: CompatTable, log?: (event: object) => void,
 *   applyWindow?: {intervalMs: number, timeoutMs: number}, confirmWindowMs?: number,
 *   present?: () => Promise<number>, rates?: number[]}} options `present` shows a few frames and
 *   returns how many; `rates` are the targets above 60 `set` accepts, PROBE_RATES at most.
 */
export function createRefreshRate(rpc, {directory, table = shippedTable, log = () => {}, applyWindow = APPLY_WINDOW,
  confirmWindowMs = CONFIRM_WINDOW_MS, present = undefined, rates = PANEL_RATES}) {
  if (!rates.every(rate => PROBE_RATES.includes(rate))) throw Error('Unsupported refresh rate target');

  /** @type {Promise<Preparation> | null} */
  let preparation = null;
  /** @type {Promise<SwapChain> | null} */
  let swapPreparation = null;
  /** True from the 301 raise until a read shows the baseline again. */
  let changed = false;
  /** A lower 301 accepted that has not landed because nothing presented. */
  let lowerPending = false;
  /** `stock` while the layer holds the default interval as far as this controller knows. */
  let swap = 'stock';
  /** The rate the raise is for: the panel at 120 and the swap interval at 1/target. */
  let target = 120;
  /** When the raise that 354 has not confirmed yet was sent; 0 once confirmed. */
  let pendingSince = 0;
  let output = 0;
  let queue = Promise.resolve();

  /** @param {Record<string, unknown>} fields */
  const report = fields => log({event: 'refresh-rate', ...fields});

  /**
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  function serial(work) {
    const next = queue.then(work);
    queue = next.then(() => {}, () => {});
    return next;
  }

  /** @returns {Promise<Walk>} */
  async function walkFromLayer() {
    const module = await readJson(directory, 'compatibility-module.json');
    const resources = (await readJson(directory, 'vulkan-display.json')).displayResources;
    if (!resources) throw Error('No display resources in vulkan-display.json');
    const base = pointer(BigInt(module.base), 'module base');
    const layer = pointer(BigInt(resources.layer), 'layer');
    const display = pointer(BigInt(resources.display), 'display');

    let hash = module.hash;
    if (typeof hash !== 'string') hash = replyString(await rpc.request({command: 'module-probe', name: 'nnCompat'}), 'hash');
    const tableOk = table.module.hash === WALK_MODULE_HASH && hash === table.module.hash;
    if (!tableOk) throw Error('nnCompat ' + hash + ' is not the walked build ' + WALK_MODULE_HASH);

    const unnamed = /** @type {Record<string, {offset: number, hex: string}> | undefined} */ (table.unnamed);
    const setterEntry = unnamed?.DisplaySession301;
    const getterEntry = unnamed?.DisplaySession354;
    const hookEntry = unnamed?.ResultErrorHook;
    if (!setterEntry || !getterEntry || !hookEntry) throw Error('Compat table lacks the DisplaySession entries');
    const setter = base + BigInt(setterEntry.offset);
    const getter = base + BigInt(getterEntry.offset);
    const handler = base + BigInt(hookEntry.offset);

    await rpc.request({command: 'verify-functions', base: hex(base), functions: [
      {name: 'DisplaySession301', offset: setterEntry.offset, hex: setterEntry.hex},
      {name: 'DisplaySession354', offset: getterEntry.offset, hex: getterEntry.hex}]});
    rpc.verifiedFunctions.set(hex(setter), setterEntry.hex);
    rpc.verifiedFunctions.set(hex(getter), getterEntry.hex);

    const record = display + WALK.privateRecord;
    const hookAddress = base + WALK.errorHook;
    const [ownerWord, recordDispatch, keyWord, hookWord] = (await readBatch(rpc, [
      {address: layer + WALK.contextOwner}, {address: record + WALK.recordDispatch},
      {address: record + WALK.recordKey}, {address: hookAddress}])).map(bytes => bytes.readBigUInt64LE());
    const owner = pointer(ownerWord, 'context owner');
    const [dispatchWord] = (await readBatch(rpc, [{address: owner}])).map(bytes => bytes.readBigUInt64LE());
    const dispatch = pointer(dispatchWord, 'dispatch object');
    if (recordDispatch !== dispatch) throw Error('Display record does not hold the layer context');
    if (keyWord === 0n) throw Error('Display key is zero');

    const [vtableWord] = (await readBatch(rpc, [{address: dispatch}])).map(bytes => bytes.readBigUInt64LE());
    const vtable = pointer(vtableWord, 'context vtable');
    const [heldWord, ...slotWords] = (await readBatch(rpc, [{address: vtable + WALK.heldSession},
      ...SLOTS.map(slot => ({address: vtable + slot.slot}))])).map(bytes => bytes.readBigUInt64LE());
    const held = pointer(heldWord, 'held session');

    /** @type {Walk['checks']} */
    const checks = [
      {address: layer + WALK.contextOwner, value: owner, label: 'context owner'},
      {address: owner, value: dispatch, label: 'dispatch object'},
      {address: dispatch, value: vtable, label: 'context vtable'},
      {address: vtable + WALK.heldSession, value: held, label: 'held session'},
      {address: record + WALK.recordDispatch, value: dispatch, label: 'display record'},
      {address: record + WALK.recordKey, value: keyWord, label: 'display key'},
      {address: hookAddress, value: hookWord, label: 'error hook'}
    ];
    /** @type {Record<string, bigint>} */
    const wrappers = {DisplaySession301: setter, DisplaySession354: getter};
    SLOTS.forEach((slot, index) => {
      const expected = slot.unnamed ? wrappers[slot.unnamed] : base + (slot.offset ?? 0n);
      if (slotWords[index] !== expected)
        throw Error('Context ' + slot.label + ' is ' + hex(slotWords[index]) + ', not ' + hex(expected));
      checks.push({address: vtable + slot.slot, value: expected, label: slot.label});
    });

    const hookKnown = hookWord === 0n || hookWord === handler;
    if (!hookKnown) throw Error('Error hook ' + hex(hookWord) + ' is not the verified handler');
    const [transport, ...handlerBytes] = await readBatch(rpc, [{address: held + WALK.sessionTransport},
      ...(hookWord ? [{address: handler, length: hookEntry.hex.length / 2}] : [])]);
    if (transport.readBigUInt64LE() === 0n) throw Error('Held session has no transport');
    if (hookWord && handlerBytes[0].toString('hex') !== hookEntry.hex) throw Error('Error hook handler bytes differ');

    output = await rpc.allocate(OUTPUT_BYTES + GUARD_BYTES, {align: 8});
    return {base, layer, setter, getter, held, key: keyWord, output: BigInt(output), checks};
  }

  /**
   * The swap interval chain from the public setter and clearer to the setter the forwarding table
   * holds: every hop's bytes, the GOT words bound or lazy, and the table's context and slots.
   * @param {Walk} walk
   * @returns {Promise<SwapChain>}
   */
  async function swapChainFrom(walk) {
    const {base, layer} = walk;
    const named = /** @type {Record<string, {offset: number, hex: string}>} */ (table.functions);
    const unnamed = /** @type {Record<string, {offset: number, hex: string}> | undefined} */ (table.unnamed);
    const entries = [...SWAP_CHAIN.map(name => [name, named[name]]), ...SWAP_UNNAMED.map(name => [name, unnamed?.[name]])];
    const missing = entries.find(([, entry]) => !entry);
    if (missing) throw Error('Compat table lacks ' + missing[0]);

    const functions = entries.map(([name, entry]) => {
      const {offset, hex: bytes} = /** @type {{offset: number, hex: string}} */ (entry);
      return {name: /** @type {string} */ (name), offset, hex: bytes};
    });
    await rpc.request({command: 'verify-functions', base: hex(base), functions});

    const tableAddress = base + SWAP.table;
    const words = (await readBatch(rpc, [...SWAP_GOT.map(entry => ({address: base + entry.offset})),
      {address: tableAddress}, {address: tableAddress + SWAP.setSlot}, {address: tableAddress + SWAP.clearSlot}]))
      .map(bytes => bytes.readBigUInt64LE());
    SWAP_GOT.forEach((entry, index) => {
      const bound = words[index] === base + entry.target;
      const lazy = words[index] === base + SWAP.lazy;
      if (!bound && !lazy) throw Error('Swap interval GOT word ' + hex(words[index]) + ' is outside the verified chain');
    });

    const [context, setSlot, clearSlot] = words.slice(SWAP_GOT.length);
    pointer(context, 'forwarding table context');
    const setter = base + BigInt(functions.find(entry => entry.name === 'ExtendedSwapIntervalSetter')?.offset ?? 0);
    const clearer = base + BigInt(functions.find(entry => entry.name === 'ExtendedSwapIntervalClearer')?.offset ?? 0);
    if (setSlot !== setter || clearSlot !== clearer) throw Error('Forwarding table slots are not the verified setter');

    const set = base + BigInt(named[SWAP_SET].offset);
    const clear = base + BigInt(named[SWAP_CLEAR].offset);
    rpc.verifiedFunctions.set(hex(set), named[SWAP_SET].hex);
    rpc.verifiedFunctions.set(hex(clear), named[SWAP_CLEAR].hex);
    const checks = [
      {address: tableAddress, value: context, label: 'forwarding context'},
      {address: tableAddress + SWAP.setSlot, value: setter, label: 'setter slot'},
      {address: tableAddress + SWAP.clearSlot, value: clearer, label: 'clearer slot'}
    ];
    return {set, clear, layer, checks};
  }

  /** @param {Walk} walk */
  function swapPrepared(walk) {
    swapPreparation ??= swapChainFrom(walk).catch(error => {
      swapPreparation = null;
      throw error;
    });
    return swapPreparation;
  }

  /** @param {SwapChain} chain */
  async function swapWord(chain) {
    const [bytes] = await readBatch(rpc, [{address: chain.layer + SWAP.guard}]);
    return bytes.readBigUInt64LE();
  }

  /**
   * One call plan on the layer: the chain checks, the u64 over the six bytes still `word`, then
   * `steps`; returns the six bytes read after it.
   * @param {SwapChain} chain
   * @param {bigint} word
   * @param {object[]} steps
   */
  async function swapPlan(chain, word, steps) {
    const guard = chain.layer + SWAP.guard;
    const checks = [...chain.checks, {address: guard, value: word, label: 'swap interval'}].map(check =>
      ({check: {u64: hex(check.address)}, equals: hex(check.value), message: 'Swap interval chain changed: ' + check.label}));
    const reply = planReply(await rpc.request({command: 'call-plan', steps: [...checks, ...steps],
      read: [{address: hex(guard), length: 8}]}));
    const after = typeof reply.memory[0] === 'string' ? reply.memory[0].slice(4) : null;

    return {after, calls: reply.calls.length, error: reply.error ? reply.error.message : null};
  }

  /**
   * 1/target on a raised panel: interval 1 is 1/60 s at any panel rate unless the extended ratio
   * is enabled. Writes only from the stock bytes; a refusal leaves the measurement to decide.
   * @param {Walk} walk
   */
  async function setSwap(walk) {
    if (swap === 'set') return;

    const requested = '1/' + target;
    const wanted = swapBytes(target);
    try {
      const chain = await swapPrepared(walk);
      const word = await swapWord(chain);
      const before = swapState(word);
      if (before === wanted) {
        swap = 'set';
        report({action: 'swap-interval', requested, before, outcome: 'set'});
        return;
      }
      if (before !== SWAP_STOCK) {
        report({action: 'swap-interval', requested, before, outcome: 'refused', reason: 'not the layer default'});
        return;
      }

      const done = await swapPlan(chain, word, [{call: hex(chain.set), name: 'SetLayerExtendedSwapInterval',
        args: [hex(chain.layer), '0x1', hex(target)]}]);
      swap = 'unknown';
      if (done.after === wanted) swap = 'set';
      if (done.after === SWAP_STOCK) swap = 'stock';
      report({action: 'swap-interval', requested, before, after: done.after,
        outcome: swap === 'set' ? 'set' : 'failed', ...(done.error ? {error: done.error} : {})});
    } catch (error) {
      report({action: 'swap-interval', requested, outcome: 'refused', reason: errorText(error)});
    }
  }

  /**
   * Back to the layer default: clear, then the stock bytes the clear zeroes the denominator of.
   * Writes only over a 1/rate this controller or the probe sets; the stock bytes need nothing.
   * @param {Walk} walk
   * @param {string} reason
   */
  async function resetSwap(walk, reason) {
    try {
      const chain = await swapPrepared(walk);
      const word = await swapWord(chain);
      const before = swapState(word);
      if (before === SWAP_STOCK) {
        swap = 'stock';
        return;
      }
      if (!SWAP_SET_BYTES.includes(before)) {
        swap = 'unknown';
        report({action: 'swap-interval', reason, before, outcome: 'failed', error: 'not a 1/rate this sets'});
        return;
      }

      const done = await swapPlan(chain, word, [
        {call: hex(chain.clear), name: 'ClearLayerExtendedSwapInterval', args: [hex(chain.layer)]},
        {write: hex(chain.layer + SWAP.state), hex: SWAP_STOCK}]);
      swap = done.after === SWAP_STOCK ? 'stock' : 'unknown';
      report({action: 'swap-interval', reason, before, after: done.after,
        outcome: swap === 'stock' ? 'restored' : 'failed', ...(done.error ? {error: done.error} : {})});
    } catch (error) {
      swap = 'unknown';
      report({action: 'swap-interval', reason, outcome: 'failed', error: errorText(error)});
    }
  }

  /** @returns {Promise<Preparation>} */
  function prepared() {
    preparation ??= walkFromLayer().then(
      walk => ({walk, reason: ''}),
      error => {
        preparation = null;
        return {walk: null, reason: errorText(error)};
      });
    return preparation;
  }

  /** @param {Walk} walk */
  function readSteps(walk) {
    return [
      {write: hex(walk.output), hex: FILL.repeat(OUTPUT_BYTES + GUARD_BYTES)},
      {call: hex(walk.getter), name: 'DisplaySession354', expect: 'vk',
        args: [hex(walk.held), hex(walk.output), hex(walk.key)]}
    ];
  }

  /**
   * @param {Walk} walk
   * @param {bigint[]} words value and mask
   */
  function setSteps(walk, [value, mask]) {
    return [
      {call: hex(walk.setter), name: 'DisplaySession301', expect: 'vk',
        args: [hex(walk.held), hex(walk.key), hex(value), hex(mask)]},
      ...readSteps(walk)
    ];
  }

  /**
   * One `refresh-rate` request: the walk checks, then `steps`.
   * @param {Walk} walk
   * @param {'raise' | 'lower' | 'none'} mark
   * @param {object[]} steps
   * @param {Record<string, string>} [fields]
   */
  async function run(walk, mark, steps, fields = {}) {
    const checks = walk.checks.map(check => ({check: {u64: hex(check.address)}, equals: hex(check.value),
      message: 'Refresh-rate walk changed: ' + check.label}));
    const plan = {steps: [...checks, ...steps], read: [{address: hex(walk.output), length: OUTPUT_BYTES + GUARD_BYTES}]};
    const reply = await rpc.request({command: 'refresh-rate', action: 'run', mark, plan, ...fields});

    return outcome(planReply(reply));
  }

  /** @returns {Promise<FlagRead>} */
  async function readFlags() {
    const {walk, reason} = await prepared();
    if (!walk) return {flags: null, result: null, reason};

    try {
      const read = await run(walk, 'none', readSteps(walk));
      return {flags: read.flags, result: read.results[0] ?? null, reason: read.error ?? 'getter output invalid'};
    } catch (error) {
      return {flags: null, result: null, reason: errorText(error)};
    }
  }

  /** Frames shown by `present`, or 0 when there is none or it fails; never throws. */
  async function presentFrames() {
    if (!present) return 0;
    try {
      return await present();
    } catch {
      return 0;
    }
  }

  /**
   * One lowering 301 plan, then 354 polls while its Result is 0 and `done` does not hold yet: the
   * display applies 301 on a later present, so each poll
   * follows a `present` batch, and the window starts once one has shown frames.
   * @param {Walk} walk
   * @param {bigint[]} words value and mask
   * @param {(flags: bigint | null) => boolean} done
   * @param {Record<string, string>} fields
   * @returns {Promise<Applied>}
   */
  async function apply(walk, words, done, fields) {
    const started = Date.now();
    const set = await run(walk, 'lower', setSteps(walk, words), fields);
    const accepted = set.results[0] === 0;
    let windowStart = started;
    let read = set;
    let polls = 0;
    let presented = 0;

    for (;;) {
      const applyMs = Date.now() - started;
      const confirmed = !read.error && done(read.flags);
      const waiting = accepted && !read.error && Date.now() - windowStart < applyWindow.timeoutMs;
      if (confirmed || !waiting)
        return {results: set.results, flags: read.flags, error: read.error, confirmed, polls, applyMs, presented};

      const frames = await presentFrames();
      if (frames && !presented) windowStart = Date.now();
      if (!frames) await delay(applyWindow.intervalMs);
      presented += frames;
      read = await run(walk, 'lower', readSteps(walk), fields);
      polls += 1;
    }
  }

  /** @param {Applied} applied */
  function applyError(applied) {
    if (applied.error) return applied.error;
    if (applied.results[0] !== 0) return null;
    return applied.confirmed ? 'unexplained flags' : 'not applied within ' + applyWindow.timeoutMs + ' ms';
  }

  /**
   * `pending` when 301 was accepted and nothing presented while polling: the lower lands on the
   * next present, so it is retried before the next raise and never calls for a reboot.
   * @param {Applied} last
   * @param {boolean} restored
   */
  function lowerOutcome(last, restored) {
    if (restored) return 'restored';
    const unpresented = last.results.at(-1) === 0 && !last.error && !last.confirmed && !last.presented;
    return unpresented ? 'pending' : 'failed';
  }

  /** @param {string} reason */
  async function lower(reason) {
    const {walk, reason: walkError} = await prepared();
    if (!walk) {
      report({action: 'restore', reason, outcome: 'failed', error: walkError, recovery: RECOVERY});
      return {ok: false};
    }
    if (swap !== 'stock') await resetSwap(walk, reason);

    try {
      const fields = {clearIf: wordHex(FLAGS_60)};
      const cleared = await apply(walk, CLEAR_120, isCleared, fields);
      const results = [...cleared.results];
      let last = cleared;
      let applyMs = cleared.applyMs;
      let polls = cleared.polls;
      let presented = cleared.presented;
      let model = 'mask';
      if (cleared.confirmed && cleared.flags === 0n) {
        last = await apply(walk, SET_60, isEnabled, fields);
        results.push(...last.results);
        applyMs += last.applyMs;
        polls += last.polls;
        presented += last.presented;
        model = 'exclusive';
      }

      const restored = last.flags === FLAGS_60;
      const outcome = lowerOutcome(last, restored);
      lowerPending = outcome === 'pending';
      if (restored) {
        changed = false;
        pendingSince = 0;
      }
      const failure = {error: applyError(last) ?? 'unexplained flags', recovery: RECOVERY};
      const detail = {restored: {model}, pending: {error: applyError(last), cause: 'no presents'}, failed: failure};
      report({action: 'restore', reason, requested: 60, result: results.map(hex),
        flags: last.flags === null ? null : hex(last.flags), outcome, applyMs, polls, presented, ...detail[outcome]});
      return {ok: restored};
    } catch (error) {
      report({action: 'restore', reason, outcome: 'failed', error: errorText(error), recovery: RECOVERY});
      return {ok: false};
    }
  }

  /** After a raise the display refused: write only when the word is not the baseline. */
  async function settle() {
    const read = await readFlags();
    if (read.flags === FLAGS_60) {
      await rpc.request({command: 'refresh-rate', action: 'clear'});
      changed = false;
      return;
    }
    await lower('raise-failed');
  }

  /**
   * @param {string} reason
   * @param {number} [requested]
   */
  function refuse(reason, requested = target) {
    report({action: 'set', requested, outcome: 'refused', reason});
    return {ok: false};
  }

  /** @param {number} rate */
  async function raise(rate) {
    if (!rates.includes(rate)) return refuse('no ' + rate + ' Hz panel mode', rate);
    if (changed && rate !== target) return refuse('raised for ' + target + ' Hz', rate);
    target = rate;

    if (lowerPending) {
      const lowered = await lower('pending-lower');
      if (!lowered.ok) return refuse('an earlier lower is still pending');
    }
    if (changed) return {ok: true};

    const baseline = await readFlags();
    if (baseline.flags === null) return refuse('baseline read failed: ' + baseline.reason);
    if (isLeftover(baseline.flags)) return adopt(baseline.flags);
    if (baseline.flags !== FLAGS_60) return refuse('baseline is ' + hex(baseline.flags) + ', not 0x1');

    return raiseFromBaseline();
  }

  /**
   * A 0x2/0x3 baseline: ours when the console record says so, otherwise lowered first as the
   * startup cleanup does.
   * @param {bigint} flags
   */
  async function adopt(flags) {
    let recorded = false;
    try {
      recorded = Boolean((await rpc.request({command: 'refresh-rate', action: 'status'})).record);
    } catch (error) {
      return refuse('record read failed: ' + errorText(error));
    }
    changed = true;
    pendingSince = isRaised(flags) ? 0 : Date.now();

    if (recorded) {
      const outcome = pendingSince ? 'pending' : 'raised';
      report({action: 'set', baseline: hex(flags), requested: target, outcome, recorded});
      const {walk} = await prepared();
      if (walk) await setSwap(walk);
      return {ok: true};
    }

    report({action: 'set', baseline: hex(flags), requested: target, outcome: 'leftover', recorded});
    const lowered = await lower('leftover');
    if (!lowered.ok) return {ok: false};

    return raiseFromBaseline();
  }

  /**
   * 301 and one 354 read: Result 0 counts as raised, confirmed now or pending until measured
   * batches confirm it.
   */
  async function raiseFromBaseline() {
    const {walk} = await prepared();
    if (!walk) return refuse('walk lost');

    try {
      const started = Date.now();
      const set = await run(walk, 'raise', setSteps(walk, SET_120), {baseline: hex(FLAGS_60)});
      if (!set.results.length) return refuse(set.error ?? 'set did not run');
      changed = true;

      const accepted = set.results[0] === 0 && !set.error;
      const confirmed = accepted && isRaised(set.flags);
      pendingSince = confirmed ? 0 : started;
      let outcome = 'failed';
      if (confirmed) outcome = 'raised';
      else if (accepted) outcome = 'pending';
      report({action: 'set', baseline: hex(FLAGS_60), requested: target, result: hex(set.results[0]),
        flags: set.flags === null ? null : hex(set.flags), outcome, ...(set.error ? {error: set.error} : {})});
      if (confirmed) await setSwap(walk);
      if (accepted) return {ok: true};

      await settle();
      return {ok: false};
    } catch (error) {
      changed = true;
      report({action: 'set', requested: target, outcome: 'failed', error: errorText(error), recovery: RECOVERY});
      return {ok: false};
    }
  }

  /**
   * A presentation batch measured after the raise. `raised` when the panel was confirmed before
   * the batch or the batch itself ran at the target (`atRate`); `pending` while 354 has not
   * switched, or has only just switched and the next batch must measure the raised panel;
   * `failed` after the window.
   * @param {{frames: number, elapsedMs: number}} measurement
   * @returns {Promise<RaiseState>}
   */
  async function confirm(measurement) {
    if (!changed) return 'failed';

    const {frames, elapsedMs} = measurement;
    const measuredHz = Math.round(frames * 1e5 / elapsedMs) / 100;
    const fields = {action: 'measured', requested: target, frames, elapsedMs, measuredHz};
    if (!pendingSince) {
      report({...fields, outcome: 'raised'});
      return 'raised';
    }

    const read = await readFlags();
    const confirmMs = Date.now() - pendingSince;
    const rateRaised = atRate(measuredHz, target);
    const flagsRaised = isRaised(read.flags);
    const expired = read.flags === null || confirmMs >= confirmWindowMs;
    let outcome = 'pending';
    if (rateRaised) outcome = 'raised';
    else if (flagsRaised) outcome = 'applied';
    else if (expired) outcome = 'failed';

    if (rateRaised || flagsRaised) pendingSince = 0;

    const flags = read.flags === null ? null : hex(read.flags);
    if (outcome !== 'failed') {
      report({...fields, flags, outcome, confirmMs});
      const {walk} = await prepared();
      if (walk && outcome !== 'pending') await setSwap(walk);
      return outcome === 'raised' ? 'raised' : 'pending';
    }

    const error = read.flags === null ? read.reason : 'not applied within ' + confirmWindowMs + ' ms';
    report({...fields, flags, outcome, confirmMs, error});
    return 'failed';
  }

  /**
   * Startup: a raise this process recorded, or one a restarted title left behind, and a 1/rate
   * left on a reused layer. The lower presents through `present` while it polls.
   */
  async function cleanup() {
    try {
      const status = await rpc.request({command: 'refresh-rate', action: 'status'});
      const recorded = Boolean(status.record);
      const read = await readFlags();
      const {walk} = await prepared();
      if (walk) await resetSwap(walk, 'startup');
      if (read.flags === null) {
        report({action: 'cleanup', recorded, outcome: 'unavailable', reason: read.reason,
          ...(recorded ? {recovery: RECOVERY} : {})});
        return;
      }

      if (read.flags === FLAGS_60) {
        if (recorded) await rpc.request({command: 'refresh-rate', action: 'clear'});
        report({action: 'cleanup', recorded, flags: hex(read.flags), outcome: 'clean'});
        return;
      }

      const leftover = isLeftover(read.flags);
      report({action: 'cleanup', recorded, flags: hex(read.flags), outcome: leftover ? 'leftover' : 'unexpected',
        ...(leftover ? {} : {recovery: RECOVERY})});
      if (!leftover) return;
      changed = true;
      await lower('startup');
    } catch (error) {
      report({action: 'cleanup', outcome: 'unavailable', reason: errorText(error)});
    }
  }

  /**
   * The panel when this controller raised it, and the swap interval if a reset failed before.
   * @param {string} reason
   */
  async function restoreAll(reason) {
    if (changed) return lower(reason);
    if (swap === 'stock') return {ok: true};

    const {walk} = await prepared();
    if (walk) await resetSwap(walk, reason);
    return {ok: swap === 'stock'};
  }

  return {
    /** Reads the 354 flag word; one request once the walk is prepared. */
    read: () => serial(readFlags),
    /**
     * A rate above 60 in `rates` raises the panel to 120, only from 0x1 (a 0x2/0x3 word is
     * adopted or lowered first), with the swap interval at 1/rate once confirmed; 60 clears the
     * 120 bit.
     */
    set: (/** @type {number} */ rate) => serial(() => rate > 60 ? raise(rate) : lower('set')),
    /** Lowers only what this controller or a leftover raised. */
    restore: (/** @type {string} */ reason) => serial(() => restoreAll(reason)),
    cleanup: () => serial(cleanup),
    /** The rate of the last raise. */
    target: () => target,
    /** Judges a batch presented after the raise by 354 and its present rate (see `confirm`). */
    measured: (/** @type {{frames: number, elapsedMs: number}} */ measurement) => serial(() => confirm(measurement)),
    close: () => serial(async () => {
      await restoreAll('stop');
      if (output && rpc.connected) await rpc.release(output).catch(() => {});
      output = 0;
      preparation = null;
      swapPreparation = null;
    })
  };
}
