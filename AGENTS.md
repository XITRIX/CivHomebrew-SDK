# Shared CivApps renderer

Use the civswitch-development skill for renderer/native/lifecycle work.
This project must build independently of every app checkout. Never import
application storage, FTP, streaming, terminal discovery or Launcher policy.
Keep the checked native ABI and process-wide ownership guards intact.

Maintain source here; consumers commit immutable, checksum-pinned releases.
Never fix a renderer by patching a consumer's vendor bundle. Bump package.json
for a new published release, run npm run build for native/build/font changes
(CIV_EMSDK selects Emscripten 3.1.74), otherwise npm run release, then npm test,
npm run test:browser and npm run test:vulkan as appropriate.
Run consumer packaging and browser/native host regressions after installation.
Keep console qualification distinct from host validation. App updates do not
authorize replacing a running native owner, changing boot triggers or deploying.
