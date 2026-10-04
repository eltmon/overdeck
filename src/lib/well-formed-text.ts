const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const REPLACEMENT_CHAR = '�';

export function toWellFormedText(text: string): string {
  return text.replace(LONE_SURROGATE, REPLACEMENT_CHAR);
}

export function truncateWellFormed(text: string, maxUnits: number): string {
  let sliced = text.slice(0, maxUnits);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}
