import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
// Babel 7 publishes CJS. Normalize its default exports for native Node ESM.
export const traverse = (traverseModule as unknown as { default: typeof traverseModule.default }).default;
export const generate = (generatorModule as unknown as { default: typeof generatorModule.default }).default;
