// Placeholder A2UI bundle.
//
// In full builds, a bundling step overwrites this file with the real A2UI bundle.
// Unit tests expect the asset route to exist; the gateway should not return 503
// just because the bundle wasn't built in this workspace.

(function () {
  // Minimal global expected by the A2UI host scaffold.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = /** @type {any} */ (globalThis);
  if (!g.openclawA2UI) g.openclawA2UI = {};
})();
