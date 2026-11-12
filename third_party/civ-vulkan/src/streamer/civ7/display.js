// The console's own vi layer and swapchain, black on every image, as call plans for console
// startup. Up to the first present the calls are HBLauncher vulkan-copy.js display mode's batch;
// its offscreen read-back check is left out, so the stage is accepted on VkResult alone.
import {planReply} from './call-plan.js';

/** @import {Civ7Rpc} from './transport.js' */
/** @import {PlanReply, RecordedStep} from './call-plan.js' */

const DISPLAY_WIDTH = 1920;
const DISPLAY_HEIGHT = 1080;
const LAYER_MAX_WIDTH = 0xf00;
const LAYER_MAX_HEIGHT = 0x870;
const LAYER_BYTES = 0x2000;
const LAYER_SETTINGS_OFFSET = 0x1000;
const LAYER_NAME_OFFSET = 0x1100;
const LAYER_NAME = 'default\0';
const WINDOW_BYTES = 0x7000;
const PAGE_BYTES = 0x1000;
const OUT_BYTES = 0x100;
const PLAN_STEPS = 512;
const POINTER_BYTES = 8;
const WORD_BYTES = 4;

const API_VERSION_1_4 = (1 << 22) | (4 << 12);
const VK_TRUE = 1;
const VK_SUCCESS = 0n;

const VI = {
  openDefaultDisplay: '_ZN2nn2vi18OpenDefaultDisplayEPPNS0_7DisplayE',
  closeDisplay: '_ZN2nn2vi12CloseDisplayEPNS0_7DisplayE',
  layer: '_ZN2nn2vi5LayerC1Ev',
  layerCreationSettings: '_ZN2nn2vi21LayerCreationSettingsC1Eii',
  openLayer: '_ZN2nn2vi5Layer4OpenEPKNS0_21LayerCreationSettingsEPNS0_7DisplayEPKc',
  nativeWindow: '_ZN2nn2vi5Layer15GetNativeWindowEv',
  closeLayer: '_ZN2nn2vi5Layer5CloseEb'
};

const TYPE = {
  applicationInfo: 0,
  instanceCreateInfo: 1,
  deviceQueueCreateInfo: 2,
  deviceCreateInfo: 3,
  submitInfo: 4,
  semaphoreCreateInfo: 9,
  imageViewCreateInfo: 15,
  commandPoolCreateInfo: 39,
  commandBufferAllocateInfo: 40,
  commandBufferBeginInfo: 42,
  swapchainCreateInfoKHR: 1000001000,
  presentInfoKHR: 1000001001,
  renderingInfo: 1000044000,
  renderingAttachmentInfo: 1000044001,
  physicalDeviceDynamicRenderingFeatures: 1000044003,
  acquireNextImageInfoKHR: 1000060010,
  viSurfaceCreateInfoNN: 1000062000,
  imageMemoryBarrier2: 1000314002,
  dependencyInfo: 1000314003,
  physicalDeviceSynchronization2Features: 1000314007
};

const QUEUE_GRAPHICS = 0x1;
const MAX_QUEUE_FAMILIES = 32;
const QUEUE_FAMILY = 0;
const IMAGE_USAGE_RENDER_AND_READ = 0x11;
const FORMAT_R8G8B8A8_UNORM = 37;
const COLOR_SPACE_SRGB_NONLINEAR = 0;
const IMAGE_VIEW_TYPE_2D = 1;
const ASPECT_COLOR = 1;
const LOAD_OP_CLEAR = 1;
const CLEAR_VALUE_OFFSET = 52;
const OPAQUE_BLACK = [0, 0, 0, 1];
const COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT = 0x1;
const COMMAND_POOL_RESET_COMMAND_BUFFER = 0x2;
const QUEUE_FAMILY_IGNORED = 0xffffffff;

const PRESENT_MODE_FIFO = 2;
const FIFO_IMAGES = 2;
const MIN_SWAPCHAIN_IMAGES = 2;
const MAX_SWAPCHAIN_IMAGES = 8;
const MAX_SURFACE_FORMATS = 64;
const SURFACE_FORMAT_BYTES = 8;
const SURFACE_CAPABILITIES_BYTES = 52;
const COMPOSITE_ALPHA_OPAQUE = 1;
const ACQUIRE_TIMEOUT_NS = 1000000000n;
const DEVICE_MASK = 1;

const STAGE_COLOR_ATTACHMENT_OUTPUT = 0x400;
const ACCESS_COLOR_ATTACHMENT_WRITE = 0x100;
const LAYOUT_UNDEFINED = 0;
const LAYOUT_COLOR_ATTACHMENT = 2;
const LAYOUT_PRESENT_SOURCE = 1000001002;

/** The swapchain image's path through each black frame. */
const TRANSITION = {
  render: {from: LAYOUT_UNDEFINED, to: LAYOUT_COLOR_ATTACHMENT, source: [0, 0],
    destination: [STAGE_COLOR_ATTACHMENT_OUTPUT, ACCESS_COLOR_ATTACHMENT_WRITE]},
  present: {from: LAYOUT_COLOR_ATTACHMENT, to: LAYOUT_PRESENT_SOURCE,
    source: [STAGE_COLOR_ATTACHMENT_OUTPUT, ACCESS_COLOR_ATTACHMENT_WRITE], destination: [0, 0]}
};

/** Output slots in the window, as vulkan-copy.js lays them out; display reuses physicalCount. */
const OUT = {
  instance: 0,
  display: 8,
  physicalCount: 8,
  physical: 16,
  familyCount: 24,
  device: 32,
  queue: 40,
  pool: 72,
  command: 80,
  imageView: 96,
  surface: 104,
  swapchain: 112,
  acquireSemaphore: 120,
  presentSemaphore: 128,
  imageIndex: 136,
  count: 144
};

/** Create-infos and query results in the window, as vulkan-copy.js lays them out. */
const AT = {
  applicationInfo: 0x100,
  instanceInfo: 0x200,
  queuePriority: 0x300,
  queueInfo: 0x400,
  synchronization2Features: 0x500,
  dynamicRenderingFeatures: 0x540,
  deviceInfo: 0x600,
  poolInfo: 0xb00,
  commandBufferInfo: 0xc00,
  beginInfo: 0xd00,
  familyProperties: 0x1000,
  submitInfo: 0x3200,
  imageViewInfo: 0x4100,
  imageBarrier: 0x4200,
  imageDependency: 0x4300,
  attachment: 0x4400,
  renderingInfo: 0x4500,
  surfaceExtension: 0x6000,
  viSurfaceExtension: 0x6040,
  instanceExtensions: 0x6080,
  surfaceInfo: 0x6100,
  surfaceCapabilities: 0x6200,
  surfaceFormats: 0x6400,
  swapchainExtension: 0x6500,
  deviceExtensions: 0x6540,
  swapchainInfo: 0x6600,
  semaphoreInfo: 0x6700,
  acquireInfo: 0x6800,
  swapchainImages: 0x6900,
  waitStageMask: 0x6a00,
  presentInfo: 0x6b00,
  frames: 0x6c00
};

/** Each later black frame's acquired index and image view, FRAME_BYTES apart from AT.frames. */
const FRAME_BYTES = 16;
const FRAME_VIEW = 8;

const FIELD = {
  surfaceWindow: 24,
  swapchainImages: 32,
  swapchainSurface: 24,
  swapchainTransform: 80,
  acquireSwapchain: 16,
  acquireSemaphore: 32,
  viewImage: 24,
  barrierImage: 64,
  attachmentView: 16,
  commandPool: 16
};

const CAPABILITY = {minImages: 0, maxImages: 4, width: 8, height: 12, transform: 40, usage: 48};

/**
 * How each display object is destroyed, with `$handle` for its own handle.
 * @type {Record<string, [string, (string | number)[]] | null>}
 */
const DESTROY = {
  instance: ['vkDestroyInstance', ['$handle', 0]],
  device: ['vkDestroyDevice', ['$handle', 0]],
  queue: null,
  commandPool: ['vkDestroyCommandPool', ['device', '$handle', 0]],
  commandBuffer: null,
  display: [VI.closeDisplay, ['$handle']],
  layer: [VI.closeLayer, ['$handle', 0]],
  surface: ['vkDestroySurfaceKHR', ['instance', '$handle', 0]],
  swapchain: ['vkDestroySwapchainKHR', ['device', '$handle', 0]],
  semaphore: ['vkDestroySemaphore', ['device', '$handle', 0]],
  imageView: ['vkDestroyImageView', ['device', '$handle', 0]]
};

/** The functions the display stage calls or records as destroy calls. */
export const DISPLAY_FUNCTIONS = [...new Set([...Object.values(VI), 'vkCreateInstance', 'vkEnumeratePhysicalDevices',
  'vkGetPhysicalDeviceQueueFamilyProperties', 'vkCreateDevice', 'vkGetDeviceQueue', 'vkCreateCommandPool',
  'vkAllocateCommandBuffers', 'vkCreateViSurfaceNN', 'vkGetPhysicalDeviceSurfaceCapabilitiesKHR',
  'vkGetPhysicalDeviceSurfaceFormatsKHR',
  'vkGetPhysicalDeviceSurfaceSupportKHR', 'vkCreateSwapchainKHR', 'vkCreateSemaphore', 'vkAcquireNextImage2KHR',
  'vkGetSwapchainImagesKHR', 'vkCreateImageView', 'vkBeginCommandBuffer', 'vkCmdPipelineBarrier2',
  'vkCmdBeginRendering', 'vkCmdEndRendering', 'vkEndCommandBuffer', 'vkQueueSubmit', 'vkQueueWaitIdle',
  'vkQueuePresentKHR', 'vkDestroyImageView',
  ...Object.values(DESTROY).flatMap(destroy => destroy ? [destroy[0]] : [])])];

/** @typedef {number | bigint | string | {u32?: string, u64?: string}} PlanArgument */

/**
 * @typedef {object} DisplayObject A created display object, for the graphics ledger.
 * @property {string} kind
 * @property {string} name
 * @property {string} handle Decimal.
 * @property {{name: string, args: Array<string | number>} | null} destroy
 */

/**
 * @typedef {object} DisplayResult What pipelines.js, launcher.json and the graphics ledger read.
 * @property {string} instance Decimal handles, as launcher.json reports them.
 * @property {string} physical
 * @property {string} device
 * @property {string} queue
 * @property {number} queueFamily
 * @property {string} swapchain
 * @property {number} imageCount
 * @property {string[]} images
 * @property {{acquire: string, present: string}} semaphores
 * @property {string} display
 * @property {number} layer
 * @property {string} surface
 * @property {string} pool
 * @property {string} command
 * @property {{index: number, cleared: number[]}} frames The first image and every one cleared.
 * @property {Size} [size] The layer, surface and swapchain extent; 1920x1080 when absent (a display
 *   an older payload retained).
 */

const hex = (/** @type {number | bigint | string} */ value) => '0x' + BigInt(value).toString(16);

/** The layer size unless a docked stream above 1080p asks for its own. */
export const DEFAULT_SIZE = Object.freeze({width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT});

/**
 * The extent a display stage opened at, as its result records it.
 * @param {{size?: unknown}} display
 * @returns {Size}
 */
export function displaySize(display) {
  const size = /** @type {Partial<Size> | undefined} */ (display.size);
  const widthOk = Number.isInteger(size?.width) && Number(size?.width) >= 1;
  const heightOk = Number.isInteger(size?.height) && Number(size?.height) >= 1;
  if (!size || !widthOk || !heightOk) return {...DEFAULT_SIZE};

  return {width: Number(size.width), height: Number(size.height)};
}

/**
 * @param {number} size
 * @param {number} type
 * @param {Record<number, number>} [words]
 * @param {Record<number, number | bigint>} [pointers]
 */
function struct(size, type, words = {}, pointers = {}) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(type);
  for (const [offset, value] of Object.entries(words)) bytes.writeUInt32LE(value, Number(offset));
  for (const [offset, value] of Object.entries(pointers)) bytes.writeBigUInt64LE(BigInt(value), Number(offset));
  return bytes;
}

/** @param {number} value */
function u32(value) {
  const bytes = Buffer.alloc(WORD_BYTES);
  bytes.writeUInt32LE(value);
  return bytes;
}

/** @param {number[]} addresses */
function pointerArray(addresses) {
  const bytes = Buffer.alloc(addresses.length * POINTER_BYTES);
  addresses.forEach((address, index) => bytes.writeBigUInt64LE(BigInt(address), index * POINTER_BYTES));
  return bytes;
}

const semaphoreInfo = () => struct(24, TYPE.semaphoreCreateInfo);
const beginInfo = () => struct(32, TYPE.commandBufferBeginInfo, {16: COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT});
const surfaceInfo = () => struct(32, TYPE.viSurfaceCreateInfoNN);

/** @typedef {{width: number, height: number}} Size */

/** @param {{images: number, presentMode: number, size: Size}} fields */
const swapchainInfo = ({images, presentMode, size}) => struct(104, TYPE.swapchainCreateInfoKHR, {
  [FIELD.swapchainImages]: images, 36: FORMAT_R8G8B8A8_UNORM, 44: size.width, 48: size.height, 52: 1,
  56: IMAGE_USAGE_RENDER_AND_READ, 84: COMPOSITE_ALPHA_OPAQUE, 88: presentMode, 92: VK_TRUE
});

const acquireInfo = () => struct(56, TYPE.acquireNextImageInfoKHR, {48: DEVICE_MASK}, {24: ACQUIRE_TIMEOUT_NS});

const imageViewInfo = () => struct(80, TYPE.imageViewCreateInfo,
  {32: IMAGE_VIEW_TYPE_2D, 36: FORMAT_R8G8B8A8_UNORM, 56: ASPECT_COLOR, 64: 1, 72: 1});

/** @param {typeof TRANSITION.render} transition */
function imageBarrierInfo(transition) {
  const [srcStage, srcAccess] = transition.source;
  const [dstStage, dstAccess] = transition.destination;
  return struct(96, TYPE.imageMemoryBarrier2,
    {48: transition.from, 52: transition.to, 56: QUEUE_FAMILY_IGNORED, 60: QUEUE_FAMILY_IGNORED,
      72: ASPECT_COLOR, 80: 1, 88: 1},
    {16: srcStage, 24: srcAccess, 32: dstStage, 40: dstAccess});
}

function attachmentInfo() {
  const attachment = struct(72, TYPE.renderingAttachmentInfo, {24: LAYOUT_COLOR_ATTACHMENT, 44: LOAD_OP_CLEAR});
  OPAQUE_BLACK.forEach((value, channel) => attachment.writeFloatLE(value, CLEAR_VALUE_OFFSET + channel * 4));
  return attachment;
}

/** @param {number} p @param {Size} size */
const renderingInfo = (p, size) => struct(72, TYPE.renderingInfo,
  {28: size.width, 32: size.height, 36: 1, 44: 1}, {48: p + AT.attachment});

/** @param {number} p */
const dependencyInfo = p => struct(64, TYPE.dependencyInfo, {48: 1}, {56: p + AT.imageBarrier});

/** @param {number} p Waits on the acquire semaphore and signals the present one. */
const submitInfo = p => struct(72, TYPE.submitInfo, {16: 1, 40: 1, 56: 1},
  {24: p + OUT.acquireSemaphore, 32: p + AT.waitStageMask, 48: p + OUT.command, 64: p + OUT.presentSemaphore});

/** @param {number} p */
const presentInfo = p => struct(64, TYPE.presentInfoKHR, {16: 1, 32: 1},
  {24: p + OUT.presentSemaphore, 40: p + OUT.swapchain, 48: p + OUT.imageIndex});

/**
 * Collects one call plan over the window at `p`, with the objects its calls create.
 * @param {number} p
 */
function planRecorder(p) {
  /** @type {RecordedStep[]} */
  const steps = [];
  /** @type {{kind: string, name: string, slot: number, call: number, destroyedBy?: number}[]} */
  const objects = [];
  let calls = 0;

  const at = (/** @type {number} */ offset) => hex(p + offset);
  const wire = (/** @type {PlanArgument} */ value) => typeof value === 'object' ? value : hex(value);
  const slot = (/** @type {number} */ offset) => ({u64: at(offset)});
  const word = (/** @type {number} */ offset) => ({u32: at(offset)});

  /** @param {string} name @param {PlanArgument[]} args @param {{expect?: string, message?: string, store?: number}} [options] */
  function call(name, args, {expect, message, store} = {}) {
    steps.push({call: name, name, args: args.map(wire), ...(expect ? {expect} : {}),
      ...(message ? {message} : {}), ...(store === undefined ? {} : {store: at(store)})});
    return calls++;
  }

  return {
    steps, objects, slot, word, call,
    /** @param {string} name @param {PlanArgument[]} args */
    ok: (name, args) => call(name, args, {expect: 'vk'}),
    /** @param {number} offset @param {Buffer} bytes */
    put: (offset, bytes) => steps.push({write: at(offset), hex: bytes.toString('hex')}),
    /** @param {number} address @param {Buffer} bytes */
    write: (address, bytes) => steps.push({write: hex(address), hex: bytes.toString('hex')}),
    /** @param {object} value @param {number} offset @param {4 | 8} width */
    copy: (value, offset, width) => steps.push({copy: value, to: at(offset), width}),
    /** @param {object} value @param {object} conditions @param {string} message */
    check: (value, conditions, message) => steps.push({check: value, ...conditions, message}),
    /** @param {number} offset @param {object} count @param {object} entry @param {string} message */
    contains: (offset, count, entry, message) => steps.push({contains: at(offset), count, ...entry, message}),
    /** @param {number} offset */
    handle: offset => steps.push({check: slot(offset), min: 1, message: 'Null output handle'}),
    /**
     * Notes the object the last call wrote to `offset`, or `address` for the layer.
     * @param {string} kind @param {string} name @param {number} offset
     */
    created: (kind, name, offset) => objects.push({kind, name, slot: offset, call: calls - 1}),
    /** The last call destroyed the newest object of `kind` called `name`. */
    destroyed(/** @type {string} */ kind, /** @type {string} */ name) {
      const object = [...objects].reverse().find(item => item.kind === kind && item.name === name);
      if (object) object.destroyedBy = calls - 1;
    }
  };
}

/** @typedef {ReturnType<typeof planRecorder>} Plan */

/**
 * vulkan-copy.js runExperiment for display mode up to the command buffer, less the memory
 * properties only its offscreen check reads, and with queue family 0 required to draw.
 * @param {Plan} plan
 * @param {number} p
 */
function deviceSteps(plan, p) {
  const {slot, word} = plan;
  plan.put(AT.surfaceExtension, Buffer.from('VK_KHR_surface\0'));
  plan.put(AT.viSurfaceExtension, Buffer.from('VK_NN_vi_surface\0'));
  plan.put(AT.instanceExtensions, pointerArray([p + AT.surfaceExtension, p + AT.viSurfaceExtension]));
  plan.put(AT.applicationInfo, struct(48, TYPE.applicationInfo, {44: API_VERSION_1_4}));
  plan.put(AT.instanceInfo, struct(64, TYPE.instanceCreateInfo, {48: 2},
    {24: p + AT.applicationInfo, 56: p + AT.instanceExtensions}));
  plan.ok('vkCreateInstance', [p + AT.instanceInfo, 0, p + OUT.instance]);
  plan.created('instance', 'vulkan', OUT.instance);
  plan.handle(OUT.instance);

  plan.ok('vkEnumeratePhysicalDevices', [slot(OUT.instance), p + OUT.physicalCount, 0]);
  plan.check(word(OUT.physicalCount), {equals: 1}, 'Expected one physical device');
  plan.ok('vkEnumeratePhysicalDevices', [slot(OUT.instance), p + OUT.physicalCount, p + OUT.physical]);
  plan.handle(OUT.physical);

  const families = 'vkGetPhysicalDeviceQueueFamilyProperties';
  plan.call(families, [slot(OUT.physical), p + OUT.familyCount, 0]);
  plan.check(word(OUT.familyCount), {min: 1, max: MAX_QUEUE_FAMILIES}, 'Invalid family count');
  plan.call(families, [slot(OUT.physical), p + OUT.familyCount, p + AT.familyProperties]);
  plan.check(word(AT.familyProperties), {mask: QUEUE_GRAPHICS}, 'Queue family 0 cannot draw');

  const priority = Buffer.alloc(4);
  priority.writeFloatLE(1);
  plan.put(AT.queuePriority, priority);
  plan.put(AT.queueInfo, struct(40, TYPE.deviceQueueCreateInfo, {20: QUEUE_FAMILY, 24: 1}, {32: p + AT.queuePriority}));
  plan.put(AT.synchronization2Features, struct(24, TYPE.physicalDeviceSynchronization2Features, {16: VK_TRUE},
    {8: p + AT.dynamicRenderingFeatures}));
  plan.put(AT.dynamicRenderingFeatures, struct(24, TYPE.physicalDeviceDynamicRenderingFeatures, {16: VK_TRUE}));
  plan.put(AT.swapchainExtension, Buffer.from('VK_KHR_swapchain\0'));
  plan.put(AT.deviceExtensions, pointerArray([p + AT.swapchainExtension]));
  plan.put(AT.deviceInfo, struct(72, TYPE.deviceCreateInfo, {20: 1, 48: 1},
    {8: p + AT.synchronization2Features, 24: p + AT.queueInfo, 56: p + AT.deviceExtensions}));
  plan.ok('vkCreateDevice', [slot(OUT.physical), p + AT.deviceInfo, 0, p + OUT.device]);
  plan.created('device', 'gpu', OUT.device);
  plan.handle(OUT.device);

  plan.call('vkGetDeviceQueue', [slot(OUT.device), QUEUE_FAMILY, 0, p + OUT.queue]);
  plan.created('queue', 'graphics', OUT.queue);
  plan.handle(OUT.queue);

  plan.put(AT.poolInfo, struct(24, TYPE.commandPoolCreateInfo,
    {16: COMMAND_POOL_RESET_COMMAND_BUFFER, 20: QUEUE_FAMILY}));
  plan.ok('vkCreateCommandPool', [slot(OUT.device), p + AT.poolInfo, 0, p + OUT.pool]);
  plan.created('commandPool', 'display', OUT.pool);
  plan.handle(OUT.pool);
  plan.put(AT.commandBufferInfo, struct(32, TYPE.commandBufferAllocateInfo, {28: 1}));
  plan.copy(slot(OUT.pool), AT.commandBufferInfo + FIELD.commandPool, 8);
  plan.ok('vkAllocateCommandBuffers', [slot(OUT.device), p + AT.commandBufferInfo, p + OUT.command]);
  plan.created('commandBuffer', 'display', OUT.command);
  plan.handle(OUT.command);
}

/**
 * vulkan-copy.js displayPlan up to vkCreateSwapchainKHR and the two semaphores.
 * @param {Plan} plan
 * @param {number} p
 * @param {number} layer
 * @param {Size} size
 */
function swapchainSteps(plan, p, layer, size) {
  const {slot, word} = plan;
  const capability = (/** @type {number} */ offset) => word(AT.surfaceCapabilities + offset);

  plan.call(VI.openDefaultDisplay, [p + OUT.display], {expect: 'zero', message: 'Display reference failed'});
  plan.created('display', 'default', OUT.display);
  plan.handle(OUT.display);
  plan.call(VI.layer, [layer]);
  plan.call(VI.layerCreationSettings, [layer + LAYER_SETTINGS_OFFSET, size.width, size.height]);
  plan.write(layer + LAYER_NAME_OFFSET, Buffer.from(LAYER_NAME));
  plan.call(VI.openLayer, [layer, layer + LAYER_SETTINGS_OFFSET, slot(OUT.display), layer + LAYER_NAME_OFFSET],
    {expect: 'zero', message: 'Independent layer failed'});
  plan.created('layer', 'moonlight', -1);

  plan.call(VI.nativeWindow, [layer], {store: AT.surfaceInfo + FIELD.surfaceWindow});
  plan.put(AT.surfaceInfo, surfaceInfo().subarray(0, FIELD.surfaceWindow));
  plan.ok('vkCreateViSurfaceNN', [slot(OUT.instance), p + AT.surfaceInfo, 0, p + OUT.surface]);
  plan.created('surface', 'vi', OUT.surface);
  plan.handle(OUT.surface);
  plan.ok('vkGetPhysicalDeviceSurfaceCapabilitiesKHR', [slot(OUT.physical), slot(OUT.surface), p + AT.surfaceCapabilities]);
  const wrongSize = 'Independent surface is not ' + size.width + 'x' + size.height;
  plan.check(capability(CAPABILITY.width), {equals: size.width}, wrongSize);
  plan.check(capability(CAPABILITY.height), {equals: size.height}, wrongSize);
  plan.check(capability(CAPABILITY.usage), {mask: IMAGE_USAGE_RENDER_AND_READ}, 'Surface cannot render and read back');

  const formats = 'vkGetPhysicalDeviceSurfaceFormatsKHR';
  plan.ok(formats, [slot(OUT.physical), slot(OUT.surface), p + OUT.count, 0]);
  plan.check(word(OUT.count), {min: 1, max: MAX_SURFACE_FORMATS}, 'Unexpected format count');
  plan.ok(formats, [slot(OUT.physical), slot(OUT.surface), p + OUT.count, p + AT.surfaceFormats]);
  plan.contains(AT.surfaceFormats, word(OUT.count),
    {stride: SURFACE_FORMAT_BYTES, width: POINTER_BYTES,
      equals: FORMAT_R8G8B8A8_UNORM + COLOR_SPACE_SRGB_NONLINEAR * 2 ** 32, limit: MAX_SURFACE_FORMATS},
    'RGBA8 surface unavailable');

  plan.ok('vkGetPhysicalDeviceSurfaceSupportKHR', [slot(OUT.physical), QUEUE_FAMILY, slot(OUT.surface), p + OUT.count]);
  plan.check(word(OUT.count), {equals: VK_TRUE}, 'Queue cannot present');
  plan.put(AT.swapchainInfo, swapchainInfo({images: 0, presentMode: PRESENT_MODE_FIFO, size}));
  plan.copy(capability(CAPABILITY.minImages), AT.swapchainInfo + FIELD.swapchainImages, 4);
  plan.copy(capability(CAPABILITY.transform), AT.swapchainInfo + FIELD.swapchainTransform, 4);
  plan.copy(slot(OUT.surface), AT.swapchainInfo + FIELD.swapchainSurface, 8);
  plan.ok('vkCreateSwapchainKHR', [slot(OUT.device), p + AT.swapchainInfo, 0, p + OUT.swapchain]);
  plan.created('swapchain', 'fifo', OUT.swapchain);
  plan.handle(OUT.swapchain);

  plan.put(AT.semaphoreInfo, semaphoreInfo());
  /** @type {[string, number][]} */
  const semaphores = [['acquire', OUT.acquireSemaphore], ['present', OUT.presentSemaphore]];
  for (const [name, offset] of semaphores) {
    plan.ok('vkCreateSemaphore', [slot(OUT.device), p + AT.semaphoreInfo, 0, p + offset]);
    plan.created('semaphore', name, offset);
    plan.handle(offset);
  }

  plan.put(AT.acquireInfo, acquireInfo());
  plan.copy(slot(OUT.swapchain), AT.acquireInfo + FIELD.acquireSwapchain, 8);
  plan.copy(slot(OUT.acquireSemaphore), AT.acquireInfo + FIELD.acquireSemaphore, 8);
}

/**
 * One black frame: acquire, view, clear, submit, present. The first frame is displayPlan's,
 * which also lists the swapchain images; later ones keep their index and view in `frame`.
 * @param {Plan} plan
 * @param {number} p
 * @param {{first: boolean, frame?: number, size: Size}} options
 */
function blackFrame(plan, p, {first, frame = 0, size}) {
  const {slot, word} = plan;
  const device = slot(OUT.device);
  const command = slot(OUT.command);
  const queue = slot(OUT.queue);
  const frameAt = AT.frames + frame * FRAME_BYTES;
  const view = first ? OUT.imageView : frameAt + FRAME_VIEW;
  const invalidImages = 'Invalid swapchain images';

  plan.ok('vkAcquireNextImage2KHR', [device, p + AT.acquireInfo, p + OUT.imageIndex]);
  if (first) {
    plan.ok('vkGetSwapchainImagesKHR', [device, slot(OUT.swapchain), p + OUT.count, 0]);
    plan.check(word(OUT.count), {min: MIN_SWAPCHAIN_IMAGES, max: MAX_SWAPCHAIN_IMAGES}, invalidImages);
    plan.check(word(OUT.imageIndex), {below: word(OUT.count)}, invalidImages);
    plan.ok('vkGetSwapchainImagesKHR', [device, slot(OUT.swapchain), p + OUT.count, p + AT.swapchainImages]);
  } else {
    plan.check(word(OUT.imageIndex), {below: word(OUT.count)}, invalidImages);
  }
  plan.copy(word(OUT.imageIndex), frameAt, WORD_BYTES);
  const image = {...slot(AT.swapchainImages), index: word(OUT.imageIndex), stride: POINTER_BYTES,
    limit: MAX_SWAPCHAIN_IMAGES};

  plan.put(AT.imageViewInfo, imageViewInfo());
  plan.copy(image, AT.imageViewInfo + FIELD.viewImage, 8);
  plan.ok('vkCreateImageView', [device, p + AT.imageViewInfo, 0, p + view]);
  plan.created('imageView', 'black' + frame, view);
  plan.handle(view);
  if (first) plan.put(AT.beginInfo, beginInfo());
  plan.ok('vkBeginCommandBuffer', [command, p + AT.beginInfo]);
  const barrier = (/** @type {typeof TRANSITION.render} */ transition) => {
    plan.put(AT.imageBarrier, imageBarrierInfo(transition));
    plan.copy(image, AT.imageBarrier + FIELD.barrierImage, 8);
    plan.put(AT.imageDependency, dependencyInfo(p));
    plan.call('vkCmdPipelineBarrier2', [command, p + AT.imageDependency]);
  };
  barrier(TRANSITION.render);
  plan.put(AT.attachment, attachmentInfo());
  plan.copy(slot(view), AT.attachment + FIELD.attachmentView, 8);
  plan.put(AT.renderingInfo, renderingInfo(p, size));
  plan.call('vkCmdBeginRendering', [command, p + AT.renderingInfo]);
  plan.call('vkCmdEndRendering', [command]);
  barrier(TRANSITION.present);
  plan.ok('vkEndCommandBuffer', [command]);

  if (first) {
    plan.put(AT.waitStageMask, u32(STAGE_COLOR_ATTACHMENT_OUTPUT));
    plan.put(AT.submitInfo, submitInfo(p));
  }
  plan.ok('vkQueueSubmit', [queue, 1, p + AT.submitInfo, 0]);
  plan.ok('vkQueueWaitIdle', [queue]);
  if (first) plan.put(AT.presentInfo, presentInfo(p));
  plan.ok('vkQueuePresentKHR', [queue, p + AT.presentInfo]);
  plan.ok('vkQueueWaitIdle', [queue]);
  plan.call('vkDestroyImageView', [device, slot(view), 0]);
  plan.destroyed('imageView', 'black' + frame);
}

/**
 * Black frames for the images the first one did not reach, numbered from `from`.
 * @param {Plan} plan
 * @param {number} p
 * @param {number} from
 * @param {number} count
 * @param {Size} size
 */
function laterFrames(plan, p, from, count, size) {
  for (let frame = from; frame < from + count; frame++) blackFrame(plan, p, {first: false, frame, size});
}

/**
 * The display stage. One allocation holds the layer (it must outlive the process's use of the
 * display, so it is never released) and the create-info window after it. Returns what the
 * pipelines and the graphics ledger need; on failure the error carries `objects`, the display
 * objects that exist.
 * @param {Pick<Civ7Rpc, 'allocate' | 'callPlan'>} rpc
 * @param {{resolve: (name: string) => Promise<number>, imageCount?: number, size?: Size}} options
 *   `imageCount` is the count the swapchain is expected to have; another count costs one more plan.
 *   `size` is the layer, surface and swapchain extent, 1920x1080 unless given; a layer keeps its
 *   size for the process (README.md, "Layer size").
 * @returns {Promise<{display: DisplayResult, objects: DisplayObject[], requests: object[]}>}
 */
export async function createDisplay(rpc, {resolve, imageCount, size = DEFAULT_SIZE}) {
  const expected = imageCount ?? FIFO_IMAGES;
  if (!Number.isInteger(expected) || expected < MIN_SWAPCHAIN_IMAGES || expected > MAX_SWAPCHAIN_IMAGES)
    throw Error('Invalid expected swapchain image count');
  const widthOk = Number.isInteger(size.width) && size.width >= 1 && size.width <= LAYER_MAX_WIDTH;
  const heightOk = Number.isInteger(size.height) && size.height >= 1 && size.height <= LAYER_MAX_HEIGHT;
  if (!widthOk || !heightOk) throw Error('Layer size outside Layer::Open bounds');

  /** @type {DisplayObject[]} */
  const objects = [];
  /** @type {object[]} */
  const requests = [];
  /** @type {Record<string, number>} */
  const functions = {};
  const values = {out: Buffer.alloc(OUT_BYTES), capabilities: Buffer.alloc(0), images: Buffer.alloc(0),
    frames: Buffer.alloc(MAX_SWAPCHAIN_IMAGES * FRAME_BYTES)};
  const handle = (/** @type {number} */ offset) => values.out.readBigUInt64LE(offset);
  const slotValue = (/** @type {number} */ offset) => offset < AT.frames
    ? handle(offset)
    : values.frames.readBigUInt64LE(offset - AT.frames);
  /** @type {number[]} */
  const cleared = [];

  try {
    const layer = await rpc.allocate(LAYER_BYTES + WINDOW_BYTES, {align: PAGE_BYTES});
    const p = layer + LAYER_BYTES;
    const reads = [
      {address: hex(p), length: OUT_BYTES},
      {address: hex(p + AT.surfaceCapabilities), length: SURFACE_CAPABILITIES_BYTES},
      {address: hex(p + AT.swapchainImages), length: MAX_SWAPCHAIN_IMAGES * POINTER_BYTES},
      {address: hex(p + AT.frames), length: MAX_SWAPCHAIN_IMAGES * FRAME_BYTES}
    ];

    /** @param {Plan} plan @returns {Promise<PlanReply>} The reply; objects are noted before an error throws. */
    async function run(plan) {
      if (plan.steps.length > PLAN_STEPS) throw Error('Display plan exceeds ' + PLAN_STEPS + ' steps');
      for (const step of plan.steps)
        if (step.call !== undefined && !functions[step.call]) functions[step.call] = await resolve(step.call);
      const resolved = (/** @type {RecordedStep} */ step) => step.call !== undefined
        ? {...step, call: hex(functions[step.call])}
        : step;
      const steps = plan.steps.map(resolved);

      const reply = planReply(await rpc.callPlan({steps, read: reads}));
      const [out, capabilities, images, frames] = reply.memory.map(text => Buffer.from(text, 'hex'));
      Object.assign(values, {out, capabilities, images, frames});
      requests.push({steps: steps.length, calls: reply.calls.length, consoleMs: reply.elapsedMs});

      for (const object of plan.objects) {
        const record = reply.calls[object.call];
        const zeroOk = record && (BigInt(record.result) & 0xffffffffn) === VK_SUCCESS;
        const succeeded = object.kind === 'queue' ? Boolean(record) : zeroOk;
        const destroyed = object.destroyedBy !== undefined && reply.calls[object.destroyedBy];
        const value = object.slot < 0 ? BigInt(layer) : slotValue(object.slot);
        if (succeeded && !destroyed && value !== 0n) objects.push(displayObject(object, value));
      }
      return reply;
    }

    const first = planRecorder(p);
    first.write(layer, Buffer.alloc(LAYER_BYTES));
    first.put(0, Buffer.alloc(OUT_BYTES));
    deviceSteps(first, p);
    swapchainSteps(first, p, layer, size);
    blackFrame(first, p, {first: true, size});
    const changed = first.steps.length;
    first.check(first.word(OUT.count), {equals: expected}, 'Swapchain image count changed');
    laterFrames(first, p, 1, expected - 1, size);

    const frameIndex = (/** @type {number} */ frame) => values.frames.readUInt32LE(frame * FRAME_BYTES);
    const reply = await run(first);
    const index = frameIndex(0);
    if (reply.error && reply.error.step !== changed) throw Error('Display step ' + reply.error.step + ': ' + reply.error.message);

    const count = values.out.readUInt32LE(OUT.count);
    if (reply.error) {
      const retry = planRecorder(p);
      laterFrames(retry, p, 1, count - 1, size);
      const second = await run(retry);
      if (second.error) throw Error('Display step ' + second.error.step + ': ' + second.error.message);
    }

    cleared.push(index, ...Array.from({length: count - 1}, (_, frame) => frameIndex(frame + 1)));
    const missing = Array.from({length: count}, (_, image) => image).filter(image => !cleared.includes(image));
    if (missing.length) {
      const extra = planRecorder(p);
      laterFrames(extra, p, 1, missing.length, size);
      const third = await run(extra);
      if (third.error) throw Error('Display step ' + third.error.step + ': ' + third.error.message);
      cleared.push(...missing.map((_, frame) => frameIndex(frame + 1)));
      const still = missing.filter(image => !cleared.includes(image));
      if (still.length) throw Error('Swapchain image ' + still[0] + ' was never cleared');
    }

    const text = (/** @type {number} */ offset) => handle(offset).toString();
    const display = {
      instance: text(OUT.instance), physical: text(OUT.physical), device: text(OUT.device), queue: text(OUT.queue),
      queueFamily: QUEUE_FAMILY, swapchain: text(OUT.swapchain), imageCount: count,
      images: Array.from({length: count}, (_, image) => values.images.readBigUInt64LE(image * POINTER_BYTES).toString()),
      semaphores: {acquire: text(OUT.acquireSemaphore), present: text(OUT.presentSemaphore)},
      display: text(OUT.display), layer, surface: text(OUT.surface), pool: text(OUT.pool), command: text(OUT.command),
      frames: {index, cleared: [...new Set(cleared)].sort((a, b) => a - b)},
      size: {width: size.width, height: size.height}
    };
    return {display, objects, requests};
  } catch (error) {
    throw Object.assign(/** @type {Error} */ (error), {objects: [...objects], requests});
  }

  /** @param {{kind: string, name: string}} object @param {bigint} value @returns {DisplayObject} */
  function displayObject({kind, name}, value) {
    const destroy = DESTROY[kind];
    /** @type {Record<string, bigint>} */
    const owners = {instance: handle(OUT.instance), device: handle(OUT.device)};
    const owned = (/** @type {string | number} */ arg) => typeof arg === 'string' && arg in owners
      ? owners[arg].toString() : arg;
    return {kind, name, handle: value.toString(), destroy: destroy && {name: destroy[0], args: destroy[1].map(owned)}};
  }
}

/**
 * The graphics ledger's destroy call for an object, with the function's verified bytes.
 * @param {{name: string, args: Array<string | number>} | null} destroy
 * @param {(name: string) => Promise<number>} resolve
 * @param {Map<string, string>} verified Address to its verified hex, as Civ7Rpc keeps them.
 */
export async function ledgerDestroy(destroy, resolve, verified) {
  if (!destroy) return null;
  const address = hex(await resolve(destroy.name));
  const signature = verified.get(address);
  if (!signature) throw Error(destroy.name + ' was not verified');
  return {address, hex: signature, args: destroy.args.map(arg => arg === '$handle' ? arg : hex(arg))};
}
