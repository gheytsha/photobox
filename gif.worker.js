/* gif.worker.js - Worker script for gif.js
 * This is a minimal worker that is loaded but not used in the main-thread implementation.
 * Included for compatibility with gif.js API.
 */
self.onmessage = function(event) {
  // Worker not used in this implementation - processing happens in main thread
  // for file:// protocol compatibility
  self.postMessage({ type: 'done', data: null });
};
