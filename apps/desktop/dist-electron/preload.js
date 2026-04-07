//#region src/preload.ts
require("electron").contextBridge.exposeInMainWorld("panopticonBridge", { isDesktopApp: () => true });
//#endregion

//# sourceMappingURL=preload.js.map