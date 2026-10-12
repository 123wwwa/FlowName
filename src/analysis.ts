import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import type { Span } from './types.js';

export const span = (node: t.Node): Span => ({ start: node.start ?? 0, end: node.end ?? 0 });
export const parseCode = (code: string) => parse(code, { sourceType: 'unambiguous', plugins: ['jsx'] });
