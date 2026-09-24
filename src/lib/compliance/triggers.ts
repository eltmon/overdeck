export interface MemoryFirstTrigger {
  id: string;
  pattern: RegExp;
}

export interface MemoryFirstTriggerMatch {
  triggerId: string;
  phrase: string;
  index: number;
}
