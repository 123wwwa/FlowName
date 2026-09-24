// Node-compatible byte operations used by the shared library and Babel.
export {Buffer} from 'buffer';
// Babel reads optional feature flags from process.env during initialization.
export const process = {env: {}, browser: true};
