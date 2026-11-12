// The call-plan building blocks renderer-pipelines.js builds the renderer from: structs, the
// work area and recorder, memory choice, shader modules, the pipeline cache and cleanup order.
import {planReply} from './call-plan.js';
import filesystem from './filesystem-functions.json' with {type: 'json'};

/** @import {Civ7Rpc} from './transport.js' */
/** @import {RecordedStep} from './call-plan.js' */

const MAX_ALLOCATION_BYTES = 67108864n;
export const MEMORY_PROPERTIES_BYTES = 520;
export const MEMORY_REQUIREMENTS_BYTES = 24;
const WORK_BYTES = 0x4000;
const PLAN_STEPS = 512;
const PLAN_WRITE_BYTES = 0x10000;
const POINTER_BYTES = 8;

export const DEVICE_PROPERTIES_BYTES = 824;
export const DEVICE_IDENTITY = {vendor: 8, device: 12, uuid: 276, bytes: 292};
const CACHE_FILE_OFFSET = 0x100;
const CACHE_CAPACITY = 1024 * 1024;
const CACHE_FILESYSTEM = {open: 'fsOpen', size: 'fsSize', read: 'fsRead', close: 'fsClose', create: 'fsCreate',
  resize: 'fsResize', write: 'fsWrite', flush: 'fsFlush', commit: 'fsCommit'};
const CACHE_VULKAN = ['vkGetPhysicalDeviceProperties', 'vkCreatePipelineCache', 'vkGetPipelineCacheData',
  'vkDestroyPipelineCache'];

export const CLEAR_COLOR = [0.012, 0.02, 0.045, 1];

export const TYPE = {
  memoryAllocateInfo: 5,
  semaphoreCreateInfo: 9,
  pipelineCacheCreateInfo: 17,
  bufferCreateInfo: 12,
  imageViewCreateInfo: 15,
  shaderModuleCreateInfo: 16,
  pipelineShaderStageCreateInfo: 18,
  pipelineVertexInputStateCreateInfo: 19,
  pipelineInputAssemblyStateCreateInfo: 20,
  pipelineViewportStateCreateInfo: 22,
  pipelineRasterizationStateCreateInfo: 23,
  pipelineMultisampleStateCreateInfo: 24,
  pipelineColorBlendStateCreateInfo: 26,
  graphicsPipelineCreateInfo: 28,
  computePipelineCreateInfo: 29,
  pipelineLayoutCreateInfo: 30,
  descriptorSetLayoutCreateInfo: 32,
  descriptorPoolCreateInfo: 33,
  descriptorSetAllocateInfo: 34,
  writeDescriptorSet: 35,
  commandPoolCreateInfo: 39,
  commandBufferAllocateInfo: 40,
  commandBufferBeginInfo: 42,
  renderingInfo: 1000044000,
  renderingAttachmentInfo: 1000044001,
  pipelineRenderingCreateInfo: 1000044002,
  memoryMapInfo: 1000271000,
  memoryBarrier2: 1000314000,
  imageMemoryBarrier2: 1000314002,
  dependencyInfo: 1000314003,
  bindDescriptorSetsInfo: 1000545003
};


const STAGE_VERTEX_SHADER = 0x8;
const STAGE_FRAGMENT_SHADER = 0x80;
const STAGE_COLOR_ATTACHMENT_OUTPUT = 0x400;
const STAGE_COMPUTE_SHADER = 0x800;
const STAGE_TRANSFER = 0x1000;
const STAGE_HOST = 0x4000;
const STAGE_GRAPHICS_SHADERS = STAGE_VERTEX_SHADER | STAGE_FRAGMENT_SHADER;
const STAGE_ALL_SHADERS = STAGE_GRAPHICS_SHADERS | STAGE_COMPUTE_SHADER;

const ACCESS_SHADER_READ = 0x20;
const ACCESS_SHADER_WRITE = 0x40;
const ACCESS_SHADER_READ_WRITE = ACCESS_SHADER_READ | ACCESS_SHADER_WRITE;
const ACCESS_COLOR_ATTACHMENT_WRITE = 0x100;
const ACCESS_TRANSFER_READ = 0x800;
const ACCESS_HOST_READ = 0x2000;

const LAYOUT_UNDEFINED = 0;
const LAYOUT_COLOR_ATTACHMENT = 2;
const LAYOUT_TRANSFER_SOURCE = 6;
const LAYOUT_PRESENT_SOURCE = 1000001002;

/** @typedef {[number, number]} Scope A stage mask and an access mask. */

export const SCOPE = {
  none: /** @type {Scope} */ ([0, 0]),
  allShadersReadWrite: /** @type {Scope} */ ([STAGE_ALL_SHADERS, ACCESS_SHADER_READ_WRITE]),
  computeReadWrite: /** @type {Scope} */ ([STAGE_COMPUTE_SHADER, ACCESS_SHADER_READ_WRITE]),
  computeWrite: /** @type {Scope} */ ([STAGE_COMPUTE_SHADER, ACCESS_SHADER_WRITE]),
  graphicsShaderRead: /** @type {Scope} */ ([STAGE_GRAPHICS_SHADERS, ACCESS_SHADER_READ]),
  colorWrite: /** @type {Scope} */ ([STAGE_COLOR_ATTACHMENT_OUTPUT, ACCESS_COLOR_ATTACHMENT_WRITE]),
  transferRead: /** @type {Scope} */ ([STAGE_TRANSFER, ACCESS_TRANSFER_READ]),
  hostRead: /** @type {Scope} */ ([STAGE_HOST, ACCESS_HOST_READ])
};

/** The swapchain image's path through a frame, as gpu-app.js records it. */
export const TRANSITIONS = [
  {from: LAYOUT_UNDEFINED, to: LAYOUT_COLOR_ATTACHMENT, source: SCOPE.none, destination: SCOPE.colorWrite},
  {from: LAYOUT_COLOR_ATTACHMENT, to: LAYOUT_TRANSFER_SOURCE, source: SCOPE.colorWrite, destination: SCOPE.transferRead},
  {from: LAYOUT_TRANSFER_SOURCE, to: LAYOUT_PRESENT_SOURCE, source: SCOPE.transferRead, destination: SCOPE.none}
];

const MEMORY_DEVICE_LOCAL = 0x1;
const MEMORY_HOST_VISIBLE = 0x2;
const MEMORY_HOST_COHERENT = 0x4;
export const MEMORY_HOST_COHERENT_VISIBLE = MEMORY_HOST_VISIBLE | MEMORY_HOST_COHERENT;
export const PRIVATE_MEMORY_PREFERENCE = [MEMORY_DEVICE_LOCAL | MEMORY_HOST_COHERENT_VISIBLE, MEMORY_HOST_COHERENT_VISIBLE];

const VK_SUCCESS = 0n;


/**
 * How each created kind is destroyed; null when its parent frees it.
 * @type {Record<string, string | null>}
 */
export const DESTROY = {
  allocation: 'release',
  buffer: 'vkDestroyBuffer',
  bufferView: 'vkDestroyBufferView',
  image: 'vkDestroyImage',
  fence: 'vkDestroyFence',
  memory: 'vkFreeMemory',
  imageView: 'vkDestroyImageView',
  semaphore: 'vkDestroySemaphore',
  commandPool: 'vkDestroyCommandPool',
  commandBuffer: null,
  descriptorSetLayout: 'vkDestroyDescriptorSetLayout',
  pipelineLayout: 'vkDestroyPipelineLayout',
  descriptorPool: 'vkDestroyDescriptorPool',
  descriptorSet: null,
  shaderModule: 'vkDestroyShaderModule',
  pipelineCache: 'vkDestroyPipelineCache',
  pipeline: 'vkDestroyPipeline'
};

/**
 * @typedef {object} Created An object in creation order, for the console ledger.
 * @property {string} kind
 * @property {string} name What it is for, such as `controls` or `view0`.
 * @property {string} handle Decimal, like the launcher reports.
 * @property {string | null} destroy The call that destroys it, or null when its parent does.
 */

/**
 * @typedef {object} Display The display stage's retained objects.
 * @property {number | bigint | string} instance
 * @property {number | bigint | string} device
 * @property {number | bigint | string} queue
 * @property {number | bigint | string} swapchain
 * @property {number} queueFamily
 * @property {number} imageCount Swapchain images the display stage created.
 * @property {{width: number, height: number}} [size] The layer's extent; 1920x1080 when absent.
 * @property {number | bigint | string} [layer] The opened vi layer.
 */

const hex = (/** @type {number | bigint | string} */ value) => '0x' + BigInt(value).toString(16);

/**
 * Builds a zeroed create-info of `size` bytes: sType at 0, u32 words and u64 values by offset.
 * @param {number} size
 * @param {number} type
 * @param {Record<number, number>} [words]
 * @param {Record<number, number | bigint>} [pointers]
 */
export function struct(size, type, words = {}, pointers = {}) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(type);
  for (const [offset, value] of Object.entries(words)) bytes.writeUInt32LE(value, Number(offset));
  for (const [offset, value] of Object.entries(pointers)) bytes.writeBigUInt64LE(BigInt(value), Number(offset));
  return bytes;
}

/** @param {number[]} words */
export function u32s(...words) {
  const bytes = Buffer.alloc(words.length * 4);
  words.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
}

/**
 * Hands out space in the work area; nothing is reused, so later plans never overwrite the
 * handles and create-infos earlier plans left behind.
 * @param {number} base
 * @param {number} [limit] Its size.
 */
export function workArea(base, limit = WORK_BYTES) {
  let next = 0;
  return {
    /** @param {number} bytes @param {number} [align] */
    reserve(bytes, align = POINTER_BYTES) {
      next = Math.ceil(next / align) * align;
      const at = base + next;
      next += bytes;
      if (next > limit) throw Error('Pipeline work area exhausted');
      return at;
    }
  };
}

/**
 * Collects one call plan. Create-infos are packed into a single write at its start; handles the
 * console produces reach them through copy steps.
 * @param {ReturnType<typeof workArea>} area
 */
export function planRecorder(area) {
  /** @type {RecordedStep[]} */
  const steps = [];
  /** @type {{offset: number, bytes: Buffer}[]} */
  const parts = [];
  /** @type {{kind: string, name: string, slot: number, call: number}[]} */
  const objects = [];
  let calls = 0;

  const slot = (/** @type {number} */ address) => ({u64: hex(address)});
  const word = (/** @type {number} */ address) => ({u32: hex(address)});
  const wire = (/** @type {number | bigint | string | object} */ value) =>
    typeof value === 'object' ? value : hex(value);

  /** @typedef {number | bigint | string | object} PlanArgument */

  /** @param {string} name @param {PlanArgument[]} args @param {string} [expect] */
  function call(name, args, expect) {
    steps.push({call: name, name, args: args.map(wire), ...(expect ? {expect} : {})});
    return calls++;
  }

  return {
    steps, objects, slot, word,

    /** @param {Buffer} bytes @param {number} [align] @returns {number} Its console address. */
    struct(bytes, align = POINTER_BYTES) {
      const offset = area.reserve(bytes.length, align);
      parts.push({offset, bytes});
      return offset;
    },

    /** @param {number} address @param {Buffer} bytes */
    put: (address, bytes) => steps.push({write: hex(address), hex: bytes.toString('hex')}),

    /** @param {object} value @param {number} address @param {4 | 8} [width] */
    copy: (value, address, width = POINTER_BYTES) => steps.push({copy: value, to: hex(address), width}),

    /** @param {object} value @param {object} conditions @param {string} message */
    check: (value, conditions, message) => steps.push({check: value, ...conditions, message}),

    call: (/** @type {string} */ name, /** @type {PlanArgument[]} */ args) => call(name, args),
    ok: (/** @type {string} */ name, /** @type {PlanArgument[]} */ args) => call(name, args, 'vk'),

    /**
     * A Vulkan call that writes one handle to `out`, checked non-null before the next step.
     * @param {string} kind
     * @param {string} label
     * @param {string} name
     * @param {PlanArgument[]} args
     * @param {number} out
     */
    create(kind, label, name, args, out) {
      objects.push({kind, name: label, slot: out, call: call(name, args, 'vk')});
      steps.push({check: slot(out), min: 1, message: 'Null output handle'});
    },

    finish() {
      if (!parts.length) return steps;
      const start = Math.min(...parts.map(part => part.offset));
      const end = Math.max(...parts.map(part => part.offset + part.bytes.length));
      if (end - start > PLAN_WRITE_BYTES) throw Error('Call plan create-infos exceed one write');
      const block = Buffer.alloc(end - start);
      for (const part of parts) part.bytes.copy(block, part.offset - start);
      return [{write: hex(start), hex: block.toString('hex')}, ...steps];
    }
  };
}

/** @typedef {ReturnType<typeof planRecorder>} PlanRecorder */

/**
 * @param {Buffer} properties VkPhysicalDeviceMemoryProperties.
 * @param {number} allowed memoryTypeBits.
 * @param {number[]} preference Required flags, most preferred first.
 * @returns {number} The first allowed type with the most preferred flags, or -1.
 */
function findMemoryType(properties, allowed, preference) {
  const count = properties.readUInt32LE();
  for (const required of preference)
    for (let type = 0; type < count; type++) {
      const allowedType = (allowed & (1 << type)) !== 0;
      const flags = properties.readUInt32LE(4 + type * 8);
      if (allowedType && (flags & required) === required) return type;
    }
  return -1;
}

/**
 * Picks the memory type and size for a buffer from its requirements.
 * @param {Buffer} properties
 * @param {Buffer} requirements VkMemoryRequirements.
 * @param {number[]} preference
 * @param {string} unavailable
 */
export function chooseMemory(properties, requirements, preference, unavailable) {
  const size = requirements.readBigUInt64LE();
  const type = findMemoryType(properties, requirements.readUInt32LE(16), preference);

  const typeOk = type >= 0;
  const sizeOk = size > 0n && size <= MAX_ALLOCATION_BYTES;
  if (!typeOk || !sizeOk) throw Error(unavailable);

  return {size, type, flags: properties.readUInt32LE(4 + type * 8)};
}

/**
 * The memory-properties query both launcher.js and gpu-app.js make.
 * @param {ReturnType<typeof planRecorder>} plan
 * @param {{count: number, physical: number}} table
 * @param {Display} display
 * @param {number} properties
 */
export function queryMemoryProperties(plan, table, display, properties) {
  plan.ok('vkEnumeratePhysicalDevices', [display.instance, table.count, 0]);
  plan.check(plan.word(table.count), {equals: 1}, 'Physical device count');
  plan.ok('vkEnumeratePhysicalDevices', [display.instance, table.count, table.physical]);
  plan.check(plan.slot(table.physical), {min: 1}, 'Null physical device');
  plan.call('vkGetPhysicalDeviceMemoryProperties', [plan.slot(table.physical), properties]);
}

/**
 * Allocates, binds and maps the memory chosen for a buffer.
 * @param {ReturnType<typeof planRecorder>} plan
 * @param {Display} display
 * @param {string} label
 * @param {{size: bigint, type: number}} choice
 * @param {{buffer: number, memory: number, mapped: number}} slots
 */
export function bindStorageMemory(plan, display, label, choice, slots) {
  const allocation = plan.struct(struct(32, TYPE.memoryAllocateInfo, {24: choice.type}, {16: choice.size}));
  plan.create('memory', label, 'vkAllocateMemory', [display.device, allocation, 0, slots.memory], slots.memory);
  plan.ok('vkBindBufferMemory', [display.device, plan.slot(slots.buffer), plan.slot(slots.memory), 0]);

  const map = plan.struct(struct(48, TYPE.memoryMapInfo, {}, {40: choice.size}));
  plan.copy(plan.slot(slots.memory), map + 24);
  plan.ok('vkMapMemory2', [display.device, map, slots.mapped]);
  plan.check(plan.slot(slots.mapped), {min: 1}, 'Invalid ' + label + ' mapping');
}

/**
 * @param {ReturnType<typeof planRecorder>} plan
 * @param {Display} display
 * @param {string} stage
 * @param {{address: number, bytes: number}} code
 * @param {number} out
 */
export function createShaderModule(plan, display, stage, code, out) {
  const info = plan.struct(struct(40, TYPE.shaderModuleCreateInfo, {}, {24: code.bytes, 32: code.address}));
  plan.create('shaderModule', stage, 'vkCreateShaderModule', [display.device, info, 0, out], out);
}

/** @param {number} stage @param {number} entry */
export const shaderStage = (stage, entry) => struct(48, TYPE.pipelineShaderStageCreateInfo, {20: stage}, {32: entry});

/**
 * @typedef {object} CacheSession A saved pipeline cache being used for this startup.
 * @property {number} memory Console memory the store reads the file into and writes it from.
 * @property {string} key
 * @property {Record<string, string>} functions Verified store functions, hex.
 * @property {Record<string, unknown>} loaded The console's `pipeline-cache-load` reply.
 * @property {boolean} seeded Whether plan 3 passed the loaded data to vkCreatePipelineCache.
 */

/** @param {unknown} error */
const messageOf = error => String(error instanceof Error ? error.message : error);

/**
 * Verifies the cache's Vulkan and save data functions and loads the saved file. Any failure
 * leaves the session null, so startup compiles without a cache.
 * @param {Pick<Civ7Rpc, 'a' | 'allocate' | 'release' | 'request'>} rpc
 * @param {string} key What the saved cache must have been made from.
 * @param {(name: string) => Promise<number>} resolve
 * @returns {Promise<{session: CacheSession | null, report: Record<string, unknown>}>}
 */
export async function openCache(rpc, key, resolve) {
  const started = Date.now();
  let memory = 0;

  try {
    /** @type {Record<string, string>} */
    const functions = {getData: hex(await resolve('vkGetPipelineCacheData'))};
    for (const name of CACHE_VULKAN) await resolve(name);
    const entries = Object.entries(CACHE_FILESYSTEM).map(([role, key]) => {
      const entry = /** @type {Record<string, {offset: number, hex: string}>} */ (filesystem)[key];
      functions[role] = hex(rpc.a.sdk + entry.offset);
      return {command: 'verify-function', address: functions[role], hex: entry.hex};
    });
    await rpc.request({command: 'batch', commands: entries});

    memory = await rpc.allocate(CACHE_FILE_OFFSET + CACHE_CAPACITY);
    const loaded = await rpc.request({command: 'pipeline-cache-load', memory: hex(memory), capacity: CACHE_CAPACITY,
      key, functions});
    const report = {status: loaded.status, ...(loaded.reason ? {reason: loaded.reason} : {}),
      ...(loaded.bytes ? {bytes: loaded.bytes} : {}), loadMs: Date.now() - started};
    return {session: {memory, key, functions, loaded, seeded: false}, report};
  } catch (error) {
    if (memory) await rpc.release(memory).catch(() => {});
    return {session: null, report: {status: 'unavailable', error: messageOf(error), loadMs: Date.now() - started}};
  }
}

/**
 * The loaded data to seed the cache with, when its vendor, device and UUID are this device's.
 * @param {CacheSession} session
 * @param {Buffer} identity The first DEVICE_IDENTITY.bytes of VkPhysicalDeviceProperties.
 * @param {Record<string, unknown>} report
 */
export function cacheSeed(session, identity, report) {
  const {loaded} = session;
  if (loaded.status !== 'loaded') return null;

  const vendorOk = loaded.vendor === identity.readUInt32LE(DEVICE_IDENTITY.vendor);
  const deviceOk = loaded.device === identity.readUInt32LE(DEVICE_IDENTITY.device);
  const uuidOk = loaded.uuid === identity.subarray(DEVICE_IDENTITY.uuid, DEVICE_IDENTITY.uuid + 16).toString('hex');
  if (!vendorOk || !deviceOk || !uuidOk) {
    Object.assign(report, {status: 'stale', reason: 'device'});
    return null;
  }

  session.seeded = true;
  return {address: Number(BigInt(String(loaded.data))), bytes: Number(loaded.bytes)};
}

/**
 * Frees the store's memory once; the cache object itself stays in the ledger.
 * @param {Pick<Civ7Rpc, 'release'>} rpc
 * @param {CacheSession} session
 */
export async function releaseCache(rpc, session) {
  const {memory} = session;
  session.memory = 0;
  if (memory) await rpc.release(memory).catch(() => {});
}

/**
 * Writes the cache back when it differs from the file it was seeded from, then frees the
 * store's memory. A failure is reported, never thrown: the pipelines already exist.
 * @param {Pick<Civ7Rpc, 'release' | 'request'>} rpc
 * @param {CacheSession} session
 * @param {Display} display
 * @param {bigint} cache
 * @param {Record<string, unknown>} report
 */
export async function saveCache(rpc, session, display, cache, report) {
  const started = Date.now();
  const {loaded} = session;
  const previous = session.seeded ? {bytes: loaded.bytes, checksum: loaded.checksum} : null;

  try {
    const saved = await rpc.request({command: 'pipeline-cache-save', memory: hex(session.memory),
      capacity: CACHE_CAPACITY, key: session.key, functions: session.functions, device: hex(display.device),
      cache: hex(cache), previous});
    Object.assign(report, {saved: saved.status, savedBytes: saved.bytes});
  } catch (error) {
    Object.assign(report, {saved: 'failed', saveError: messageOf(error)});
  } finally {
    await releaseCache(rpc, session);
  }

  Object.assign(report, {seeded: session.seeded, saveMs: Date.now() - started});
}

/**
 * Runs recorded plans: resolves their functions, reads back `reads` and records each object a
 * call created before any error in the plan is thrown.
 * @param {Pick<Civ7Rpc, 'callPlan'>} rpc
 * @param {{resolve: (name: string) => Promise<number>, functions: Record<string, number>, created: Created[],
 *   requests: object[], reads: {address: string, length: number}[], table: {start: number},
 *   onCreated?: (objects: Created[]) => Promise<void>}} options
 */
export function planRunner(rpc, {resolve, functions, created, requests, reads, table, onCreated}) {
  /** @param {ReturnType<typeof planRecorder>} plan */
  return async function run(plan) {
    const named = plan.finish();
    if (named.length > PLAN_STEPS) throw Error('Pipeline plan exceeds ' + PLAN_STEPS + ' steps');
    for (const step of named)
      if (step.call !== undefined && !functions[step.call]) functions[step.call] = await resolve(step.call);
    const resolved = (/** @type {RecordedStep} */ step) => step.call !== undefined
      ? {...step, call: hex(functions[step.call])}
      : step;
    const steps = named.map(resolved);

    const reply = planReply(await rpc.callPlan({steps, read: reads}));
    const [handles, ...memory] = reply.memory.map(text => Buffer.from(text, 'hex'));
    const value = (/** @type {number} */ slot) => handles.readBigUInt64LE(slot - table.start);
    requests.push({steps: steps.length, calls: reply.calls.length, consoleMs: reply.elapsedMs});

    const before = created.length;
    for (const object of plan.objects) {
      const record = reply.calls[object.call];
      const succeeded = record && (BigInt(record.result) & 0xffffffffn) === VK_SUCCESS;
      const handle = value(object.slot);
      if (succeeded && handle !== 0n)
        created.push({kind: object.kind, name: object.name, handle: String(handle), destroy: DESTROY[object.kind]});
    }
    if (onCreated && created.length > before) await onCreated(created.slice(before));
    if (reply.error) throw Error('Pipelines step ' + reply.error.step + ': ' + reply.error.message);
    return {value, memory};
  };
}


/**
 * The created objects that need their own destroy call, newest first; command buffers and
 * descriptor sets go with their pools.
 * @param {Created[]} created
 */
export function cleanupOrder(created) {
  return created.filter(object => object.destroy).reverse();
}
