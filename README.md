# CivHomebrew-SDK

SDK version **1.0.0**, native UI API **1**. A shared NanoVG renderer for CivApps,
with retained geometry/fonts, native Vulkan rendering, a browser WebGL oracle,
serialized foreground view leases and an exclusive video surface lease.

Source repository: [XITRIX/CivHomebrew-SDK](https://github.com/XITRIX/CivHomebrew-SDK).

The SDK initially provides the `civapps-native-ui` module and its complete
NanoVG toolchain and host tests. It has no dependency on either application
checkout. Moonlight and CivHomebrew vendor the same immutable SDK release and
build offline without this checkout.

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

Loading the exact release again preserves the service, factories and owners.
A different version, or an older unversioned native service, is rejected before
module evaluation. Update both apps and restart Civ VII when changing the
resident renderer. API 1 describes the view contract; it is not permission to
mix renderer releases in one process.

Moonlight declares:

```json
{"extensions":{"nativeUi":{"api":1,"library":"civapps-native-ui","version":"1.0.0"}}}
```

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
python3 tools/release.py --install /path/to/Moonlight --install /path/to/CivHomebrew
```

The binary archive includes `install.py`; from its extracted directory run
`python3 install.py --from-release . --install /path/to/app`.

An already extracted release can also be installed from a checkout with
`python3 tools/release.py --from-release /path/to/release --install /path/to/app`.
This validates all release files before changing a consumer. Each app commits
`civapps-native-ui.lock.json`, `app/vendor/native-ui-runtime.js`, its NOTICE,
`tools/civapps_native_ui.py` and `tools/civapps-native-ui/`. The lock pins exact hashes and version; builds
verify it without reading this checkout. Consumers must also update declared
`nativeUi.version` capabilities when upgrading. Never edit a vendored bundle.

Run each consumer's package, browser/lifecycle and native host GPU checks after
an upgrade. Deployments and console roundtrips are separate validation steps.
The first extracted release has host validation; earlier console qualification
belongs to the original application builds, not automatically to this release.

## License and provenance

GPL-3.0-or-later. See `LICENSE`, `PROVENANCE.json` and pinned `third_party/`
notices for the original bridge/Vulkan, NanoVG and font sources. All native,
shader, font and build sources required to rebuild the release are included.
