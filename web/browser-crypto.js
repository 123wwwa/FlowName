import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

// Narrow adapter for the shared library's source identity checks.
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('Unsupported source hash algorithm');
  const hash = sha256.create();
  return {
    update(value) { hash.update(new TextEncoder().encode(value)); return this; },
    digest(format) { if (format !== 'hex') throw new Error('Unsupported hash format'); return bytesToHex(hash.digest()); },
  };
}
