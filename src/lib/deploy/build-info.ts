declare const __OVERDECK_BUILD_COMMIT__: string;
declare const __OVERDECK_BUILD_TIME__: string;

export interface BuildInfo {
  readonly buildCommit: string | null;
  readonly builtAt: string | null;
}

export function getBuildInfo(): BuildInfo {
  return {
    buildCommit:
      typeof __OVERDECK_BUILD_COMMIT__ === 'string' ? __OVERDECK_BUILD_COMMIT__ : null,
    builtAt: typeof __OVERDECK_BUILD_TIME__ === 'string' ? __OVERDECK_BUILD_TIME__ : null,
  };
}
