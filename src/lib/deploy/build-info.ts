declare const __OVERDECK_BUILD_COMMIT__: string;
declare const __OVERDECK_BUILD_TIME__: string;
declare const __OVERDECK_BUILD_DIRTY__: boolean;
declare const __OVERDECK_BUILD_BRANCH__: string | null;

export interface BuildInfo {
  readonly buildCommit: string | null;
  readonly builtAt: string | null;
  readonly buildDirty: boolean | null;
  readonly buildBranch: string | null;
}

export function getBuildInfo(): BuildInfo {
  return {
    buildCommit:
      typeof __OVERDECK_BUILD_COMMIT__ === 'string' ? __OVERDECK_BUILD_COMMIT__ : null,
    builtAt: typeof __OVERDECK_BUILD_TIME__ === 'string' ? __OVERDECK_BUILD_TIME__ : null,
    buildDirty:
      typeof __OVERDECK_BUILD_DIRTY__ === 'boolean' ? __OVERDECK_BUILD_DIRTY__ : null,
    buildBranch:
      typeof __OVERDECK_BUILD_BRANCH__ === 'string' ? __OVERDECK_BUILD_BRANCH__ : null,
  };
}
