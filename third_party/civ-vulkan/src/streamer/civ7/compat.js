// Locates nnCompat, hashes its MOD0, dynamic, hash, symbol and string tables, and verifies a
// shipped function table against the live bytes. Shipped by toString(): everything it uses
// arrives through its arguments. The PC computes the same hash from a capture with moduleTables.

/** @import {ConsoleNative, ConsoleRequest} from './console-runtime.js' */

/**
 * One QueryMemory result.
 * @typedef {{base: bigint, size: bigint, state: number, attributes: number, permissions: number}} MemoryRegion
 */

/**
 * Walks the tables captureModule reads and folds each into one 32-bit FNV-1a chain.
 * @param {(offset: number, length: number) => Uint8Array} read Bytes at a module offset.
 * @param {(sequence: number, fields: number[]) => number} nativeChecksum ring.nativeChecksum.
 */
export function moduleTables(read, nativeChecksum) {
  const imageLimit = 512 * 1024 * 1024;
  const tableLimit = 64 * 1024 * 1024;
  /**
   * @param {Uint8Array} bytes
   * @param {number} at
   */
  const u32 = (bytes, at) => ((bytes[at] | 0) | (bytes[at + 1] | 0) << 8 |
    (bytes[at + 2] | 0) << 16 | (bytes[at + 3] | 0) << 24) >>> 0;
  let hash = 0;
  let hashed = 0;

  /**
   * @param {number} offset
   * @param {number} length
   */
  function take(offset, length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= imageLimit ||
        !Number.isSafeInteger(length) || length < 1 || length > tableLimit)
      throw Error('Invalid module table range');
    const bytes = read(offset, length);
    const words = [offset, length];
    for (let at = 0; at < length; at += 4) words.push(u32(bytes, at));
    hash = nativeChecksum(hash, words);
    hashed += length;
    return bytes;
  }

  const header = take(0, 16);
  const modOffset = u32(header, 4);
  if (modOffset < 8 || modOffset >= imageLimit) throw Error('Invalid MOD0 offset');
  const mod = take(modOffset, 28);
  if (u32(mod, 0) !== 0x30444f4d) throw Error('Missing MOD0 header');
  const dynamicOffset = modOffset + u32(mod, 4);
  const imageSize = modOffset + u32(mod, 12);
  if (imageSize <= dynamicOffset || imageSize > imageLimit) throw Error('Invalid mapped image bounds');

  /** @type {Map<number, number>} */
  const tags = new Map();
  let ended = false;
  for (let index = 0; index < 128 && !ended; index++) {
    const entry = take(dynamicOffset + index * 16, 16);
    const tag = u32(entry, 0) + u32(entry, 4) * 0x100000000;
    if (tag === 0) ended = true;
    else tags.set(tag, u32(entry, 8) + u32(entry, 12) * 0x100000000);
  }
  if (!ended || tags.get(11) !== 24) throw Error('Unsupported module dynamic tables');
  const hashTable = tags.get(4);
  const stringTable = tags.get(5);
  const symbolTable = tags.get(6);
  const stringBytes = tags.get(10);
  if (hashTable === undefined || stringTable === undefined || symbolTable === undefined || stringBytes === undefined)
    throw Error('Unsupported module dynamic tables');

  const counts = read(hashTable, 8);
  const buckets = u32(counts, 0);
  const symbols = u32(counts, 4);
  take(hashTable, 8 + 4 * (buckets + symbols));
  take(symbolTable, symbols * 24);
  take(stringTable, stringBytes);

  return {hash: hash.toString(16).padStart(8, '0'), imageSize, symbols, hashed};
}

/**
 * `module-probe`: finds the module named `request.name` the way findModule does on the PC and
 * returns its base and table hash.
 * @param {Pick<ConsoleNative, 'checkMemory' | 'readMemory'> & {query: (address: bigint) => MemoryRegion,
 *   moduleTables: typeof import('./compat.js').moduleTables,
 *   nativeChecksum: (sequence: number, fields: number[]) => number}} native
 * @param {ConsoleRequest} request
 */
export function probeModule(native, request) {
  const {query, checkMemory, readMemory, moduleTables, nativeChecksum} = native;
  const name = request.name;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw Error('Invalid module name');
  const pattern = Array.from(name, character => character.charCodeAt(0));

  /**
   * @param {Uint8Array} header
   * @param {number} index
   */
  function nameAt(header, index) {
    if (index > 0 && header[index - 1] !== 0) return false;
    if (pattern.some((value, offset) => header[index + offset] !== value)) return false;
    const end = index + pattern.length;
    const mod = String.fromCharCode(header[end], header[end + 1], header[end + 2], header[end + 3]);
    return header[end] === 0 || mod === 'MOD0';
  }

  let base = -1n;
  let cursor = 0n;
  for (let count = 0; base < 0n && cursor < (1n << 39n); count++) {
    if (count >= 2048) throw Error('Memory map exceeds region limit');
    const region = query(cursor);
    if (region.size === 0n || region.base + region.size <= cursor) break;
    const textEnd = region.base + region.size;
    cursor = textEnd;
    if (!region.state || !(region.permissions & 4)) continue;
    const next = query(textEnd);
    if (next.base !== textEnd || !next.state || !(next.permissions & 1)) continue;
    checkMemory(textEnd, 128, 1);
    const header = readMemory(textEnd, 128);
    for (let index = 0; index + pattern.length < 128; index++)
      if (nameAt(header, index)) {
        base = region.base;
        break;
      }
  }
  if (base < 0n) throw Error('Loaded module not found: ' + name);

  const tables = moduleTables((offset, length) => {
    const pointer = base + BigInt(offset);
    checkMemory(pointer, length, 1);
    return readMemory(pointer, length);
  }, nativeChecksum);
  return {base: '0x' + base.toString(16), ...tables};
}

/**
 * `verify-functions`: checks every entry against the live bytes first and marks them callable
 * only when all match, so one mismatch leaves nothing verified.
 * @param {Pick<ConsoleNative, 'address' | 'integer' | 'checkMemory' | 'readMemory' | 'fromHex' | 'verified'>} native
 * @param {ConsoleRequest} request
 */
export function verifyFunctions(native, request) {
  const {address, integer, checkMemory, readMemory, fromHex, verified} = native;
  const base = address(request.base);
  if (!Array.isArray(request.functions) || request.functions.length < 1 || request.functions.length > 256)
    throw Error('Invalid function table');

  /** @type {string[]} */
  const checked = [];
  for (const entry of /** @type {ConsoleRequest[]} */ (request.functions)) {
    const pointer = base + BigInt(integer(entry.offset, 0, 512 * 1024 * 1024));
    const expected = fromHex(entry.hex);
    if (pointer % 4n || expected.length < 4 || expected.length > 256 || expected.length % 4)
      throw Error('Invalid function signature');
    checkMemory(pointer, expected.length, 5);
    const actual = readMemory(pointer, expected.length);
    if (actual.some((value, index) => value !== expected[index]))
      throw Error('Compatibility function mismatch: ' + String(entry.name || '').slice(0, 128));
    checked.push('0x' + pointer.toString(16));
  }

  for (const pointer of checked) verified.add(pointer);
  return {verified: checked.length};
}
