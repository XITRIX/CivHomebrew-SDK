# CivHomebrew-SDK

SDK version **1.3.5**, native UI API **1**. A shared NanoVG renderer for CivApps,
with retained geometry/fonts, native Vulkan rendering, a browser WebGL oracle,
serialized foreground view leases and an exclusive video surface lease.

Source repository: [XITRIX/CivHomebrew-SDK](https://github.com/XITRIX/CivHomebrew-SDK).

The SDK provides a lightweight platform core, the `civapps-native-ui` renderer,
its complete NanoVG toolchain, packaging tools and standalone host tests. It has no dependency on either application
checkout. Launcher, Hello CivHomebrew, Moonlight and Doom vendor the same immutable SDK release and
build offline without this checkout.

## Shared modules and consumers

- `civhomebrew-sdk.js`: checked SDK symbol resolution, external-buffer copies,
  private native stacks, Npad/browser controller sampling and vibration, app view
  binding and a reusable RGBA framebuffer API. The resident boot/core use this
  lightweight artifact without initializing graphics.
- `civapps-native-ui.js`: the same core plus NanoVG geometry/fonts, the shared
  Vulkan helpers/context, shaders, browser oracle and serialized view leases.
- `tooling/`: the standalone `.civapp` packager, bounded raw loader sender and
  classic-JS module compiler. Consumers pin these tools with the runtime.

Launcher owns catalog/install/FTP, terminal discovery and app transitions.
Hello demonstrates SDK app/view/input use. Moonlight owns Sunshine, codecs,
stream scheduling and host/settings storage. Doom owns its engine, WADs, save
formats, audio mixer and game controls; its UI and 320x200 framebuffer use the
SDK's existing display. No game assets are included in the SDK.

`CivHomebrewSDK` is the public platform entry point (`native`, `graphics`,
`bytes`, `transfer`, `stack`, `controller`, `app`, `framebuffer`, `nativeUI`,
`graphicsModules`). App adapters contain policy and protocol glue; shared
implementations and regression oracles are maintained here.

The SDK core reuses an existing compatible release without redefining its modules. The resident core builder may
explicitly replace a bootstrap core before any native UI backend or graphics
owner exists, using its guarded bootstrap handoff. This lets a cold core update
upgrade SDK fixes without trapping it on an older bootstrap version. Apps cannot
replace an already initialized renderer. A new native renderer release requires a Civ VII restart. Apps must declare
any required minimum release or capabilities; older same-major pins remain compatible.

## Genuine inline keyboard

SDK 1.3.5 adds `CivAppsNativeUI.keyboard.open({session, root, view, error})`
(also exported as `CivSDKKeyboard.open`) for the native renderer. Acquire before
activating the shipped `fxs-textbox`; close the returned lease after the original
IME callback has completed, and on editor/app cleanup. It borrows the game's
1280×720 RGBA keyboard image and uses the existing exclusive framebuffer texture.
The game retains keyboard input, callbacks, allocation and applet ownership.
A second framebuffer lease is refused rather than replacing another app's pixels.

This native adapter is guarded for Civ VII cartridge 1.0.0 on Switch 2. The
96-byte game image reader and every returned pointer/size/state are checked.
It does not call display visibility setters or destroy the renderer. Host tests
cover ownership and failures; the user confirmed visible Moonlight pairing,
confirmation, cancellation and reopening on 2026-11-12. This does not qualify
other game builds or hardware. Consumers using it must declare native UI
`minVersion: "1.3.5"`; compatible older same-major app releases remain usable.

## Runtime contract

Load `civapps-native-ui.js` before your app's initializer, using ordered direct
eval so the console's lexical native bridge remains visible. The public entry
point is `window.CivAppsNativeUI`:

```js
const ui = window.CivAppsNativeUI;
// The resident Launcher starts the process-wide session once.
const session = ui.sessions.current || await ui.sessions.start();
// Apps borrow views. Keep the app's lifetime pending until cleanup completes.
const view = await session.attach(root);
await view.close(); // preserves the native display, caches and session
```

Apps running under the resident Launcher must require its existing session;
they must not create a second owner when it is missing. `sessions.pending`
exposes initialization in progress. The resident owns `session.close()`.
Native presentation resources remain retained until process exit, including
after session close; native owner recreation is deliberately rejected.

`CivHomebrewSDK.app.mount(root, options)` borrows the existing view and owns
only that lease. It permits DOM preview without graphics and refuses to start a
second native session under a resident that has no compatible owner. When the
resident still uses Gameface (no native renderer owner), it returns a DOM
**Update Launcher** blocker lease (`blocked: true`). Check this before starting
app work, publish its `close` method as the foreground app cleanup, and await
its `lifetime` before returning. B/Back or Escape dismisses the screen; closing
the lease also releases its input handlers. Pending native session startup is
awaited before deciding. Browser previews keep their existing behavior.

```js
const view = await CivHomebrewSDK.app.mount(root);
if (view && view.blocked) {
  window.__civswitchApp = view;
  await view.lifetime;
  if (window.__civswitchApp === view) delete window.__civswitchApp;
  return; // do not initialize the application behind the blocker
}
```

`CivHomebrewSDK.framebuffer.create({session, view, canvas, width, height})`
adds an RGBA pixel source to a DOM canvas. `present(bytes)` uploads a complete
frame and forces a redraw even when the UI geometry is unchanged. `close()`
releases the exclusive lease. Pixel textures use nearest sampling; fonts and
normal PNGs keep their existing filtering. Up to eight retained dimension slots
share an 8 MiB budget per session, so repeated Doom starts reuse one slot.

`session.renderer.bindSurface(callback)` exclusively lends completed RGBA GPU
output to a video presenter. Its returned lease releases only that surface.
The presenter must finish its native work before releasing it. The library does
not own streaming protocols, video decoders, input, app navigation, storage,
FTP, terminal discovery or resident-core lifetime.

Use `data-civ-native-ui="1"` on roots for the bundled proportional font. Fonts,
DOM snapshotting and geometry are also exposed as `views`, `scene`, `geometry`
and `web`. The existing `CivNanoVG*` globals are compatibility exports for the
current adapters; new consumers should enter through `CivAppsNativeUI`.

DOM support is a bounded subset: axis-aligned layout, solid colors, rounded
borders, bundled/data-URL PNGs, text and rectangular clips. It does not implement
arbitrary HTML/CSS. For multiline text without DOM Range, use block elements or
preformatted newlines; flowing text split across inline nodes and `<br>` is not
fully laid out by the fallback. Transforms and shadows produce warnings.

Loading a compatible release preserves the resident service, factories and native
owner. Both the lightweight SDK guard and full UI guard require API 1 and the
same stable release major version; minor and patch differences are allowed in
either direction. A release number identifies bundled bytes, not a minimum
runtime requirement. Breaking API/ABI changes require a new API/major boundary;
compatible releases must preserve that contract. Existing unversioned owners
and inconsistent session exports still reject before module evaluation. A
bootstrap handoff may upgrade the core only before a native/UI owner exists.

Apps can declare optional requirements:

```json
{"extensions":{"nativeUi":{"api":1,"library":"civapps-native-ui","version":"1.3.2","minVersion":"1.3.0","capabilities":["native-ui","framebuffer"]}}}
```

`version` records the bundled release and selects its compatible major. Omit
`minVersion` unless the app needs an implementation introduced in that release;
it is an inclusive minimum within the same major. `capabilities` lists required
SDK interfaces, not device/hardware support. Stable versions use `major.minor.patch`
without prerelease/build suffixes. API-only declarations remain supported.
The SDK exports `compatibility.validate(requirements)` and
`compatibility.assert(runtime, requirements)` for launch preflight. Core
capabilities are `app`, `bytes`, `controller`, `framebuffer`, `graphics`, `native`,
`stack`, and `transfer`; the full UI adds `native-ui`, `scene`, `geometry`, and
`web`. Older runtimes without capability advertisements cannot satisfy explicit
capability requirements. The runtime descriptor's version remains the resident
implementation's version when an app reuses it.

Consumer lock files still pin exact versions and SHA-256 hashes for reproducible
builds. The installer updates bundled-version provenance without changing an
app's optional minimum or capability requirements. There is no live native owner
replacement: installing an updated Launcher/core still requires restarting Civ
VII to activate new resident bytes. Already distributed bundles with the old
exact-version guard need one SDK refresh; updating the Launcher cannot rewrite
those guards. SDK 1.3.2 consumers tolerate subsequent compatible releases.

## Build and test

Python 3.10+, Node 22+, Emscripten **3.1.74**, and `glslangValidator` are required
for a native dependency rebuild. Point `CIV_EMSDK` at an existing Emscripten SDK
or install it under `toolchains/emsdk`. No dependencies are downloaded by builds.

```sh
CIV_EMSDK=/path/to/emsdk npm run build
npm test
npm run test:browser
npm run test:vulkan
```

The source build compiles NanoVG to plain JS (no runtime Wasm/Workers), builds
SPIR-V and the matching browser shader, and emits a release. Generated inputs
are checked in under `vendor/`; JS renderer changes can use `npm run release`
without the native toolchain. Native/build/font/artwork changes require the full
build. Pinned upstream hashes, generated-input hashes and release checksums are
verified. The native ABI remains guarded for the qualified Switch 2 / Civ VII
cartridge 1.0.0 target; extraction does not qualify other hardware or builds.

The standalone browser suite checks the WebGL oracle, font/percentage spacing,
view handoff, missing-Range fallback, alpha and cleanup. The Vulkan suite executes
the release SPIR-V with an independent alpha assertion. It needs a host Vulkan
driver and headers (`VULKAN_INCLUDE`, `VULKAN_LIB`, `CC` can override defaults).
`CHROME_BIN` selects Chrome. Shared Chrome/Vulkan test support is released under
`testing/` and pinned by consumers under `tools/civapps-native-ui/`; neither app
maintains a second copy of that test implementation. App screen parity tests
remain with their respective apps.

## Releases and consumer updates

All renderer fixes go in this repo. Increment `package.json` for a published
change, build, test, then publish `dist/civhomebrew-sdk-VERSION.tar.gz` with its
SHA-256, alongside `dist/civhomebrew-sdk-source-VERSION.tar.gz`. The source
archive contains this standalone project without build caches or Git metadata.
The deterministic runtime archive contains the runtime, notices, checksums and
consumer verification helper and shared host test tools. Rebuilding an existing version with different
bytes is rejected. `vendor/manifest.json` records compiler and native inputs.

From the library checkout, install the same release in both consumers:

```sh
python3 tools/release.py --install /path/to/Moonlight --install /path/to/CivHomebrew --install /path/to/CivHomebrew/examples/hello --install /path/to/Doom --revision FULL_COMMIT_SHA
```

The binary archive includes `install.py`; from its extracted directory run
`python3 install.py --from-release . --install /path/to/app`.

An already extracted release can also be installed from a checkout with
`python3 tools/release.py --from-release /path/to/release --install /path/to/app`.
This validates all release files before changing a consumer. Each app commits
`civapps-native-ui.lock.json`, `app/vendor/native-ui-runtime.js`, its NOTICE,
`tools/civapps_native_ui.py` and `tools/civapps-native-ui/`. The lock pins exact hashes and version; builds
verify it without reading this checkout. The installer updates matching declared `nativeUi.version` capabilities and
records `--revision` as immutable source provenance. Shared native module
fingerprints remain checked against streaming extension requirements. Never edit a vendored bundle.

Run each consumer's package, browser/lifecycle and native host GPU checks after
an upgrade. Deployments and console roundtrips are separate validation steps.
The first extracted release has host validation; earlier console qualification
belongs to the original application builds, not automatically to this release.

## License and provenance

GPL-3.0-or-later. See `LICENSE`, `PROVENANCE.json` and pinned `third_party/`
notices for the original bridge/Vulkan, NanoVG and font sources. All native,
shader, font and build sources required to rebuild the release are included.

## Dynamic framebuffer performance

RGBA updates reuse their pixel allocation and bypass temporary C heap copies.
The packet builder repacks only changed textures; unchanged font atlases and
geometry stay retained. The native renderer uploads versioned texture ranges,
including all changes since its last presented packet when frames are skipped.
Texture-layout changes still trigger a complete upload. Native writes borrow
the correct backing-store slice synchronously, preserving ABI/range checks and
queue completion before reuse.

`node --jitless testing/framebuffer-benchmark.cjs OLD_RUNTIME NEW_RUNTIME` measures
CPU preparation for a 320x200 framebuffer with a retained HUD. This is not a
console FPS benchmark; use separate engine, packet preparation, upload, GPU and
audio timings on the actual console.

Framebuffer presentation defers the graphics queue wait until the next native
upload, allowing CPU work to overlap the preceding GPU frame. Output reads,
sampling, video-surface handoff, refresh changes and normal close drain the queue
first. GPU-owned mapped input and submission records are never reused before
completion. Ordinary UI updates remain synchronous. Pass
`deferPresentWait:false` to framebuffer creation to request synchronous output.

## Test ownership

The SDK owns generic renderer, native stack, buffer transfer, `.civapp` packager
and loader sender tests. `npm test` runs these without any application checkout.
Consumers keep their own screens, packaging order, lifecycle, storage, streaming
and game integration tests. Vendored release tooling is verified by the consumer
lock; changes to shared tooling belong here and require a new release.
