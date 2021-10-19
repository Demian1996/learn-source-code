/**
 * @description 入口文件
 */
export { start } from "./start.js";
export { ensureJQuerySupport } from "./jquery-support.js";
export {
  setBootstrapMaxTime,
  setMountMaxTime,
  setUnmountMaxTime,
  setUnloadMaxTime,
} from "./applications/timeouts.js";
export {
  registerApplication,
  unregisterApplication,
  getMountedApps,
  getAppStatus,
  unloadApplication,
  checkActivityFunctions,
  getAppNames,
  pathToActiveWhen,
} from "./applications/apps.js";
// navigation-events在导入时会执行相关逻辑，监听hashchange和popstate，修改pushState和replaceState
// 这样，当url变化和前端路由触发时，就可以触发reroute
export { navigateToUrl } from "./navigation/navigation-events.js";
export { triggerAppChange } from "./navigation/reroute.js";
export {
  addErrorHandler,
  removeErrorHandler,
} from "./applications/app-errors.js";
export { mountRootParcel } from "./parcels/mount-parcel.js";

export {
  NOT_LOADED,
  LOADING_SOURCE_CODE,
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  MOUNTING,
  UPDATING,
  LOAD_ERROR,
  MOUNTED,
  UNMOUNTING,
  SKIP_BECAUSE_BROKEN,
} from "./applications/app.helpers.js";

import devtools from "./devtools/devtools";
import { isInBrowser } from "./utils/runtime-environment.js";

/**
 * @description 暴露方法给single-spa的浏览器插件
 */
if (isInBrowser && window.__SINGLE_SPA_DEVTOOLS__) {
  window.__SINGLE_SPA_DEVTOOLS__.exposedMethods = devtools;
}
