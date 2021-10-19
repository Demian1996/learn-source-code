/**
 * @description 初始化子应用的逻辑
 */
import {
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { reasonableTime } from "../applications/timeouts.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";

/**
 * @description 将app映射为bootstrapApp的promise
 */
export function toBootstrapPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 如果当前子应用不是未初始化（也可以认为是待初始化）的状态，则直接返回
    if (appOrParcel.status !== NOT_BOOTSTRAPPED) {
      return appOrParcel;
    }

    // 将应用状态改为初始化中BOOTSTRAPPING
    appOrParcel.status = BOOTSTRAPPING;

    // 如果周期函数没有bootStrap，则执行默认逻辑
    // 默认逻辑：算作应用成功初始化，执行成功初始化的回调函数，改为未装载状态NOT_MOUNTED
    if (!appOrParcel.bootstrap) {
      // Default implementation of bootstrap
      return Promise.resolve().then(successfulBootstrap);
    }

    return (
      reasonableTime(appOrParcel, 'bootstrap')
        // 调用完app的bootstrap周期函数后，认为app已经初始化完成
        // 因此执行成功初始化的回调函数，改为未装载状态NOT_MOUNTED
        .then(successfulBootstrap)
        .catch((err) => {
          if (hardFail) {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
            return appOrParcel;
          }
        })
    );
  });

  /**
   * @description 成功初始化后的回调函数，将app状态改为未挂载
   */
  function successfulBootstrap() {
    appOrParcel.status = NOT_MOUNTED;
    return appOrParcel;
  }
}
