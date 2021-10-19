/**
 * @description 移除子应用的逻辑
 */
import {
  NOT_MOUNTED,
  UNLOADING,
  NOT_LOADED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  toName,
} from "../applications/app.helpers.js";
import { handleAppError } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

const appsToUnload = {};

/**
 * @description 将app映射为unloadApp的promise
 */
export function toUnloadPromise(app) {
  return Promise.resolve().then(() => {
    const unloadInfo = appsToUnload[toName(app)];

    if (!unloadInfo) {
      /* No one has called unloadApplication for this app,
       */
      return app;
    }

    if (app.status === NOT_LOADED) {
      // 如果app已经被unload（移除），需要将app上的各类周期函数的字段删除
      /* This app is already unloaded. We just need to clean up
       * anything that still thinks we need to unload the app.
       */
      finishUnloadingApp(app, unloadInfo);
      return app;
    }

    if (app.status === UNLOADING) {
      /* Both unloadApplication and reroute want to unload this app.
       * It only needs to be done once, though.
       */
      return unloadInfo.promise.then(() => app);
    }

    if (app.status !== NOT_MOUNTED && app.status !== LOAD_ERROR) {
      /* The app cannot be unloaded until it is unmounted.
       */
      return app;
    }

    const unloadPromise =
      app.status === LOAD_ERROR
        ? Promise.resolve()
        // 调用app的upload周期函数
        // 从load.js中的toLoadPromise可知，之前下载完成的子应用，它的周期函数一定是promise，所以此处调用时不用判空
        : reasonableTime(app, "unload");

    // 将app的状态改为移除中
    app.status = UNLOADING;

    return unloadPromise
      .then(() => {
        // 调用完app的upload周期函数后，认为app已经被移除
        // 移除过的app需要将app上的周期函数字段删除掉
        // 同时将app的状态从UNLOADING（移除中）改为NOT_LOADED（未下载），相当于将子应用改为了初始状态（registerApplications之前的状态）
        finishUnloadingApp(app, unloadInfo);
        return app;
      })
      .catch((err) => {
        errorUnloadingApp(app, unloadInfo, err);
        return app;
      });
  });
}

function finishUnloadingApp(app, unloadInfo) {
  delete appsToUnload[toName(app)];

  // Unloaded apps don't have lifecycles
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  app.status = NOT_LOADED;

  /* resolve the promise of whoever called unloadApplication.
   * This should be done after all other cleanup/bookkeeping
   */
  unloadInfo.resolve();
}

function errorUnloadingApp(app, unloadInfo, err) {
  delete appsToUnload[toName(app)];

  // Unloaded apps don't have lifecycles
  delete app.bootstrap;
  delete app.mount;
  delete app.unmount;
  delete app.unload;

  handleAppError(err, app, SKIP_BECAUSE_BROKEN);
  unloadInfo.reject(err);
}

export function addAppToUnload(app, promiseGetter, resolve, reject) {
  appsToUnload[toName(app)] = { app, resolve, reject };
  Object.defineProperty(appsToUnload[toName(app)], "promise", {
    get: promiseGetter,
  });
}

export function getAppUnloadInfo(appName) {
  return appsToUnload[appName];
}
