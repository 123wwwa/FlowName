export interface Span { start: number; end: number }
export interface SymbolInfo {
  id: string;
  name: string;
  kind: string;
  scope: string;
  declaration: Span;
  references: Span[];
  eligible: boolean;
  namingRole?: 'function' | 'class';
  exclusion?: string;
}
export interface Definition { id: string; symbol: string; span: Span; kind: string }
export interface Use { id: string; symbol: string; span: Span; definitions: string[] }
export interface Relation { from: string; to: string; kind: 'assignment' | 'co-use' | 'property' | 'argument' | 'return'; span: Span; property?: string }
export interface Analysis {
  version: 1;
  sourceHash: string;
  symbols: SymbolInfo[];
  definitions: Definition[];
  uses: Use[];
  relations: Relation[];
  warnings: string[];
  flowMode: 'structured-cfg' | 'conservative' | 'lexical-relations';
}
export type Strategy = 'individual' | 'batch' | 'flow' | 'flow-relations';
export type PromptFormat = 'compact' | 'verbose';
export interface InferenceRequest {
  promptFormat?: PromptFormat;
  formatRepair?: boolean;
  targets: SymbolInfo[];
  context: string;
  relations: Relation[];
  defUses: Use[];
  definitions: Definition[];
}
export interface InferenceResult {
  names: Record<string, string>;
  inputTokens: number | null;
  outputTokens: number | null;
  usage?: Record<string, unknown>;
  rawResponse?: string;
  httpStatus?: number;
  validation?: { unresolved: Record<string,string>; ignoredIds: string[] };
}
export interface Provider {
  label: string;
  infer(request: InferenceRequest): Promise<InferenceResult>;
}
