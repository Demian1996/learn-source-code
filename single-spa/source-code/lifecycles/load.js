/**
 * @description 下载子应用的逻辑
 */
import {
  LOAD_ERROR,
  NOT_BOOTSTRAPPED,
  LOADING_SOURCE_CODE,
  SKIP_BECAUSE_BROKEN,
  NOT_LOADED,
  objectType,
  toName,
} from '../applications/app.helpers.js';
import { ensureValidAppTimeouts } from '../applications/timeouts.js';
import { handleAppError, formatErrorMessage } from '../applications/app-errors.js';
import { flattenFnArray, smellsLikeAPromise, validLifecycleFn } from './lifecycle.helpers.js';
import { getProps } from './prop.helpers.js';
import { assign } from '../utils/assign.js';

/**
 * @description 将app映射为loadApp的promise
 */
export function toLoadPromise(app) {
  return Promise.resolve().then(() => {
    // 若当前app正在加载，则直接返回该promise
    if (app.loadPromise) {
      return app.loadPromise;
    }

    // 如果当前应用的状态不需要下载脚本，则直接返回当前应用
    if (app.status !== NOT_LOADED && app.status !== LOAD_ERROR) {
      return app;
    }

    // 下载app的脚本文件，所以此时将app的状态改为LOADING_SOURCE_CODE
    app.status = LOADING_SOURCE_CODE;

    let appOpts, isUserErr;

    return (app.loadPromise = Promise.resolve()
      .then(() => {
        const loadPromise = app.loadApp(getProps(app));
        // 规定loadPromise为promise
        if (!smellsLikeAPromise(loadPromise)) {
          // The name of the app will be prepended to this error message inside of the handleAppError function
          isUserErr = true;
          throw Error(
            formatErrorMessage(
              33,
              __DEV__ &&
                `single-spa loading function did not return a promise. Check the second argument to registerApplication('${toName(
                  app
                )}', loadingFunction, activityFunction)`,
              toName(app)
            )
          );
        }
        return loadPromise.then((val) => {
          app.loadErrorTime = null;

          // 将下载完的子应用脚本文件导出的模块（该模块为子应用封装的周期函数集合）赋值给appOpts
          appOpts = val;

          let validationErrMessage, validationErrCode;

          // 如果下载完成的脚本没有导入任何周期函数，则抛出异常
          if (typeof appOpts !== 'object') {
            validationErrCode = 34;
            if (__DEV__) {
              validationErrMessage = `does not export anything`;
            }
          }

          // 校验周期函数
          if (
            // ES Modules don't have the Object prototype
            Object.prototype.hasOwnProperty.call(appOpts, 'bootstrap') &&
            !validLifecycleFn(appOpts.bootstrap)
          ) {
            validationErrCode = 35;
            if (__DEV__) {
              validationErrMessage = `does not export a valid bootstrap function or array of functions`;
            }
          }

          // 校验周期函数
          if (!validLifecycleFn(appOpts.mount)) {
            validationErrCode = 36;
            if (__DEV__) {
              validationErrMessage = `does not export a mount function or array of functions`;
            }
          }

          // 校验周期函数
          if (!validLifecycleFn(appOpts.unmount)) {
            validationErrCode = 37;
            if (__DEV__) {
              validationErrMessage = `does not export a unmount function or array of functions`;
            }
          }

          // 通过检测unmountThisParcel，判断当前应用的类型是application还是parcel
          const type = objectType(appOpts);

          if (validationErrCode) {
            let appOptsStr;
            try {
              appOptsStr = JSON.stringify(appOpts);
            } catch {}
            console.error(
              formatErrorMessage(
                validationErrCode,
                __DEV__ &&
                  `The loading function for single-spa ${type} '${toName(
                    app
                  )}' resolved with the following, which does not have bootstrap, mount, and unmount functions`,
                type,
                toName(app),
                appOptsStr
              ),
              appOpts
            );
            handleAppError(validationErrMessage, app, SKIP_BECAUSE_BROKEN);
            return app;
          }

          if (appOpts.devtools && appOpts.devtools.overlays) {
            app.devtools.overlays = assign({}, app.devtools.overlays, appOpts.devtools.overlays);
          }

          // 下载完远程子应用的脚本文件后，将状态改为NOT_BOOTSTRAPPED
          app.status = NOT_BOOTSTRAPPED;
          // 将子应用的周期函数数组展平为promise链，并注入给app对象
          // 如bootstrap为[fn1, fn2, fn3]，fn1、fn2、fn3均为(props) => Promise<any>的格式
          // 展平后的函数为: (props) => Promise.resolve().then(() => fn1(props)).then(() => fn2(props))的格式
          // 查看flattenFnArray可知，经过load的app，即使子应用没有定义周期函数，它的周期函数也一定为promise
          app.bootstrap = flattenFnArray(appOpts, 'bootstrap');
          app.mount = flattenFnArray(appOpts, 'mount');
          app.unmount = flattenFnArray(appOpts, 'unmount');
          app.unload = flattenFnArray(appOpts, 'unload');
          app.timeouts = ensureValidAppTimeouts(appOpts.timeouts);

          // app已经下载完成，删除下载远程脚本文件的promise
          delete app.loadPromise;

          return app;
        });
      })
      .catch((err) => {
        // app下载失败，删除下载远程脚本文件的逻辑
        delete app.loadPromise;

        let newStatus;
        if (isUserErr) {
          // 如果是用户写的有问题，则将状态设置为SKIP_BECAUSE_BROKEN
          newStatus = SKIP_BECAUSE_BROKEN;
        } else {
          // 如果是下载失败，则记录状态为LOAD_ERROR，设置下载错误的时间
          // 后续reroute时，触发getAppChanges，会将该app重新推入待下载的app列表
          newStatus = LOAD_ERROR;
          app.loadErrorTime = new Date().getTime();
        }
        handleAppError(err, app, newStatus);

        return app;
      }));
  });
}
