// `refresh-rate`: runs one refresh-rate call plan and keeps, in window.__moonlightState, whether
// this process left the display raised, so a later payload send restores it (refresh-rate.js).
// Shipped by toString(): everything it uses arrives through `native`.

/** @import {ConsoleRequest} from './console-runtime.js' */
/** @import {runCallPlan} from './call-plan.js' */

/**
 * @typedef {object} RefreshRateRecord
 * @property {number} version
 * @property {number} requested
 * @property {string} baseline 354 flag word before the raise, hex.
 * @property {'raising' | 'raised'} state `raising` while the 301 call runs.
 */

/**
 * Actions: `status`, `clear`, and `run` with `mark` `raise` (record before the plan, kept only if
 * a call ran), `lower` (record dropped when the first read range starts with `clearIf`) or `none`.
 * @param {{state: {refreshRate?: RefreshRateRecord | null},
 *   runPlan: (plan: ConsoleRequest) => ReturnType<typeof runCallPlan>}} native
 * @param {ConsoleRequest} request
 */
export function refreshRateCommand(native, request) {
  const {state, runPlan} = native;
  const VERSION = 1;
  const previous = state.refreshRate || null;

  if (request.action === 'status') return {record: previous};
  if (request.action === 'clear') {
    state.refreshRate = null;
    return {record: null};
  }
  if (request.action !== 'run') throw Error('Invalid refresh-rate action');

  const mark = request.mark;
  if (mark !== 'raise' && mark !== 'lower' && mark !== 'none') throw Error('Invalid refresh-rate mark');
  const plan = request.plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw Error('Invalid refresh-rate plan');

  if (mark === 'raise') {
    const baseline = request.baseline;
    if (typeof baseline !== 'string' || !/^0x[0-9a-f]{1,16}$/.test(baseline))
      throw Error('Invalid refresh-rate baseline');
    state.refreshRate = {version: VERSION, requested: 120, baseline, state: 'raising'};
  }

  const reply = runPlan(/** @type {ConsoleRequest} */ (plan));

  if (mark === 'raise') {
    const record = /** @type {RefreshRateRecord} */ (state.refreshRate);
    state.refreshRate = reply.calls.length ? {...record, state: 'raised'} : previous;
  }

  if (mark === 'lower') {
    const clearIf = request.clearIf;
    if (typeof clearIf !== 'string' || !/^[0-9a-f]{16}$/.test(clearIf)) throw Error('Invalid refresh-rate clear word');
    const first = reply.memory[0];
    if (!reply.error && typeof first === 'string' && first.startsWith(clearIf)) state.refreshRate = null;
  }

  return {...reply, record: state.refreshRate || null};
}
