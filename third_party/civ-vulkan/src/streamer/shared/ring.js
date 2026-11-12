/**
 * Layout of the Moonlight app's private storage (binding 1): control words, the unused frame
 * ring the offsets still count, the decoded frames and the UI pages. See README.md.
 */
const SLOTS = 8;
const EXCHANGE_BYTES = 0x8000;
const SLOT_EXCHANGES = 9;
const SLOT_BYTES = SLOT_EXCHANGES * EXCHANGE_BYTES;
const CONTROL_BYTES = 0x10000;
const RING_OFFSET = CONTROL_BYTES;
/** Every slot fits a 3840x2160 NV12 frame with 16-row padding; smaller streams use its start. */
const FRAME_STRIDE = 3840;
const FRAME_HEIGHT = 2176;
const LUMA_BYTES = FRAME_STRIDE * FRAME_HEIGHT;
const CHROMA_BYTES = (FRAME_STRIDE / 2) * (FRAME_HEIGHT / 2);
const FRAME_BYTES = LUMA_BYTES + 2 * CHROMA_BYTES;
const FRAMES_OFFSET = RING_OFFSET + SLOTS * SLOT_BYTES;
const NATIVE_FRAMES = 3;
/** One spare page: unaligned 12-byte loads in the shader may read a word past the last frame. */
const SPARE_BYTES = 4096;
/** The console UI pages (U2) follow the spare page: two buffers the host publishes into. */
const UI_OFFSET = FRAMES_OFFSET + NATIVE_FRAMES * FRAME_BYTES + SPARE_BYTES;
const UI_PAGES = 2;
const UI_PAGE_BYTES = 4 * 1024 * 1024;
const MEMORY_BYTES = UI_OFFSET + UI_PAGES * UI_PAGE_BYTES;
/** Byte offsets of the control words; written[] is one word per macroblock from its offset. */
const CONTROL = {
  applied: 0,
  applyCount: 4,
  mode: 8,
  current: 12,
  size: 16,
  nativeReady: 24,
  nativeApplied: 32,
  currentStride: 64,
  currentSliceHeight: 68,
  currentColor: 72,
  nativeSequence: 256,
  nativeIndex: 260,
  nativeWidth: 264,
  nativeHeight: 268,
  nativeStride: 272,
  nativeSliceHeight: 276,
  nativeColor: 280,
  nativeCommit: 284,
  written: 1024
};
/**
 * Byte offsets of the console UI block in the control page, above written[]. The host owns
 * uiMagic..uiPage and hostAck/hostBusy; the compute shader owns uiApplied..cmdEpoch. See team
 * note `moonlight-ui-design.md`, "Memory and words".
 */
const UI_BLOCK = 0xc000;
const UI = {
  uiMagic: UI_BLOCK,
  uiEpoch: UI_BLOCK + 4,
  uiSequence: UI_BLOCK + 8,
  uiPage: UI_BLOCK + 12,
  uiApplied: UI_BLOCK + 16,
  uiCursor: UI_BLOCK + 20,
  uiOverlay: UI_BLOCK + 24,
  uiTouchItem: UI_BLOCK + 28,
  cmdSequence: UI_BLOCK + 32,
  cmdOp: UI_BLOCK + 36,
  cmdItem: UI_BLOCK + 40,
  cmdValue: UI_BLOCK + 44,
  cmdPage: UI_BLOCK + 48,
  cmdEpoch: UI_BLOCK + 52,
  uiShown: UI_BLOCK + 56,
  uiEdit: UI_BLOCK + 60,
  hostAck: UI_BLOCK + 64,
  hostBusy: UI_BLOCK + 68
};
const UI_MAGIC = 0x49554248;
/** Command operations the compute shader forwards; the host's state machine interprets them. */
const UI_OP = {a: 1, b: 2, x: 3, y: 4, adjust: 5, chord: 6, edit: 7};
const MODE = {none: 0, native: 3};
const NATIVE_ABI = 0x484e5633;

/**
 * Byte offset of frame buffer `index`.
 * @param {number} index
 * @returns {number}
 */
function frameOffset(index) {
  return FRAMES_OFFSET + index * FRAME_BYTES;
}

/**
 * 32-bit FNV-1a over whole words: the sequence, then the native frame fields.
 * @param {number} sequence
 * @param {number[]} fields
 * @returns {number}
 */
function nativeChecksum(sequence, fields) {
  const FNV_OFFSET_BASIS = 2166136261;
  const FNV_PRIME = 16777619;
  let checksum = FNV_OFFSET_BASIS;
  for (const value of [sequence, ...fields])
    checksum = Math.imul(checksum ^ value, FNV_PRIME) >>> 0;
  return checksum;
}

export {
  SLOTS,
  EXCHANGE_BYTES,
  SLOT_BYTES,
  CONTROL_BYTES,
  RING_OFFSET,
  FRAME_STRIDE,
  FRAME_HEIGHT,
  FRAME_BYTES,
  NATIVE_FRAMES,
  FRAMES_OFFSET,
  UI_OFFSET,
  UI_PAGES,
  UI_PAGE_BYTES,
  UI,
  UI_MAGIC,
  UI_OP,
  MEMORY_BYTES,
  CONTROL,
  MODE,
  NATIVE_ABI,
  frameOffset,
  nativeChecksum
};
