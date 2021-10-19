/**
 * 主应用类似于一个状态机，负责维护各个子应用的加载状态
 * 子应用的显示和卸载的周期函数由自己实现。
 * 主应用加载完子应用后，会监听路由变化，动态变更子应用状态，并调用其周期函数。
 */
/**
 * 官方中文文档对子应用的各周期函数定义如下：
 * load: 下载
 * bootstrap: 初始化
 * mount： 挂载
 * unmount： 卸载
 * unload：移除
 */
import { ensureJQuerySupport } from '../jquery-support.js';
import {
  isActive,
  toName,
  NOT_LOADED,
  NOT_BOOTSTRAPPED,
  NOT_MOUNTED,
  MOUNTED,
  LOAD_ERROR,
  SKIP_BECAUSE_BROKEN,
  LOADING_SOURCE_CODE,
  shouldBeActive,
} from './app.helpers.js';
import { reroute } from '../navigation/reroute.js';
import { find } from '../utils/find.js';
import { toUnmountPromise } from '../lifecycles/unmount.js';
import { toUnloadPromise, getAppUnloadInfo, addAppToUnload } from '../lifecycles/unload.js';
import { formatErrorMessage } from './app-errors.js';
import { isInBrowser } from '../utils/runtime-environment.js';
import { assign } from '../utils/assign';

// 应用集合
const apps = [];

/**
 * @description 将应用根据状态进行分类 appsToUnload、appsToUnmount、appsToLoad、appsToMount
 */
export function getAppChanges() {
  const appsToUnload = [],
    appsToUnmount = [],
    appsToLoad = [],
    appsToMount = [];

  // We re-attempt to download applications in LOAD_ERROR after a timeout of 200 milliseconds
  const currentTime = new Date().getTime();

  apps.forEach((app) => {
    // 根据app的加载状态和activeWhen判断是否是active
    const appShouldBeActive = app.status !== SKIP_BECAUSE_BROKEN && shouldBeActive(app);

    switch (app.status) {
      case LOAD_ERROR:
        // 将当前应该active但是加载失败的应用推入待下载数组
        if (appShouldBeActive && currentTime - app.loadErrorTime >= 200) {
          appsToLoad.push(app);
        }
        break;
      case NOT_LOADED:
      case LOADING_SOURCE_CODE:
        if (appShouldBeActive) {
          appsToLoad.push(app);
        }
        break;
      // 应用registerApplication完时状态为NOT_BOOTSTRAPPED
      // 所以在执行start时，会被推入下面的appsToUnload或appsToMount数组，具体要看路由和appsToUpload数组
      case NOT_BOOTSTRAPPED:
      case NOT_MOUNTED:
        if (!appShouldBeActive && getAppUnloadInfo(toName(app))) {
          appsToUnload.push(app);
        } else if (appShouldBeActive) {
          appsToMount.push(app);
        }
        break;
      case MOUNTED:
        if (!appShouldBeActive) {
          appsToUnmount.push(app);
        }
        break;
      // all other statuses are ignored
    }
  });

  return { appsToUnload, appsToUnmount, appsToLoad, appsToMount };
}

export function getMountedApps() {
  return apps.filter(isActive).map(toName);
}

export function getAppNames() {
  return apps.map(toName);
}

// used in devtools, not (currently) exposed as a single-spa API
export function getRawAppData() {
  return [...apps];
}

export function getAppStatus(appName) {
  const app = find(apps, (app) => toName(app) === appName);
  return app ? app.status : null;
}

/**
 * @description 完成子应用注册
 * 关键函数
 */
export function registerApplication(appNameOrConfig, appOrLoadApp, activeWhen, customProps) {
  // 校验和规范化参数
  const registration = sanitizeArguments(appNameOrConfig, appOrLoadApp, activeWhen, customProps);

  // 检测当前应用集合中是否已存在要注册的应用
  if (getAppNames().indexOf(registration.name) !== -1)
    throw Error(
      formatErrorMessage(
        21,
        __DEV__ && `There is already an app registered with name ${registration.name}`,
        registration.name
      )
    );

  // 将注册的应用和默认状态合并后，推入应用集合中，此时该应用状态为NOT_LOADED
  apps.push(
    assign(
      {
        loadErrorTime: null,
        status: NOT_LOADED,
        parcels: {},
        devtools: {
          overlays: {
            options: {},
            selectors: [],
          },
        },
      },
      registration
    )
  );

  if (isInBrowser) {
    // 初始化jquery
    ensureJQuerySupport();
    // 调用reroute，装载应用
    reroute();
  }
}

export function checkActivityFunctions(location = window.location) {
  return apps.filter((app) => app.activeWhen(location)).map(toName);
}

export function unregisterApplication(appName) {
  if (apps.filter((app) => toName(app) === appName).length === 0) {
    throw Error(
      formatErrorMessage(
        25,
        __DEV__ && `Cannot unregister application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  return unloadApplication(appName).then(() => {
    const appIndex = apps.map(toName).indexOf(appName);
    apps.splice(appIndex, 1);
  });
}

export function unloadApplication(appName, opts = { waitForUnmount: false }) {
  if (typeof appName !== 'string') {
    throw Error(formatErrorMessage(26, __DEV__ && `unloadApplication requires a string 'appName'`));
  }
  const app = find(apps, (App) => toName(App) === appName);
  if (!app) {
    throw Error(
      formatErrorMessage(
        27,
        __DEV__ && `Could not unload application '${appName}' because no such application has been registered`,
        appName
      )
    );
  }

  const appUnloadInfo = getAppUnloadInfo(toName(app));
  if (opts && opts.waitForUnmount) {
    // We need to wait for unmount before unloading the app

    if (appUnloadInfo) {
      // Someone else is already waiting for this, too
      return appUnloadInfo.promise;
    } else {
      // We're the first ones wanting the app to be resolved.
      const promise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => promise, resolve, reject);
      });
      return promise;
    }
  } else {
    /* We should unmount the app, unload it, and remount it immediately.
     */

    let resultPromise;

    if (appUnloadInfo) {
      // Someone else is already waiting for this app to unload
      resultPromise = appUnloadInfo.promise;
      immediatelyUnloadApp(app, appUnloadInfo.resolve, appUnloadInfo.reject);
    } else {
      // We're the first ones wanting the app to be resolved.
      resultPromise = new Promise((resolve, reject) => {
        addAppToUnload(app, () => resultPromise, resolve, reject);
        immediatelyUnloadApp(app, resolve, reject);
      });
    }

    return resultPromise;
  }
}

function immediatelyUnloadApp(app, resolve, reject) {
  toUnmountPromise(app)
    .then(toUnloadPromise)
    .then(() => {
      resolve();
      setTimeout(() => {
        // reroute, but the unload promise is done
        reroute();
      });
    })
    .catch(reject);
}

function validateRegisterWithArguments(name, appOrLoadApp, activeWhen, customProps) {
  if (typeof name !== 'string' || name.length === 0)
    throw Error(
      formatErrorMessage(20, __DEV__ && `The 1st argument to registerApplication must be a non-empty string 'appName'`)
    );

  if (!appOrLoadApp)
    throw Error(
      formatErrorMessage(
        23,
        __DEV__ && 'The 2nd argument to registerApplication must be an application or loading application function'
      )
    );

  if (typeof activeWhen !== 'function')
    throw Error(
      formatErrorMessage(24, __DEV__ && 'The 3rd argument to registerApplication must be an activeWhen function')
    );

  if (!validCustomProps(customProps))
    throw Error(formatErrorMessage(22, __DEV__ && 'The optional 4th argument is a customProps and must be an object'));
}

/**
 * @description 对config的各参数命名进行校验
 */
export function validateRegisterWithConfig(config) {
  if (Array.isArray(config) || config === null)
    throw Error(formatErrorMessage(39, __DEV__ && "Configuration object can't be an Array or null!"));
  const validKeys = ['name', 'app', 'activeWhen', 'customProps'];
  const invalidKeys = Object.keys(config).reduce(
    (invalidKeys, prop) => (validKeys.indexOf(prop) >= 0 ? invalidKeys : invalidKeys.concat(prop)),
    []
  );
  if (invalidKeys.length !== 0)
    throw Error(
      formatErrorMessage(
        38,
        __DEV__ &&
          `The configuration object accepts only: ${validKeys.join(', ')}. Invalid keys: ${invalidKeys.join(', ')}.`,
        validKeys.join(', '),
        invalidKeys.join(', ')
      )
    );
  if (typeof config.name !== 'string' || config.name.length === 0)
    throw Error(formatErrorMessage(20, __DEV__ && 'The config.name on registerApplication must be a non-empty string'));
  if (typeof config.app !== 'object' && typeof config.app !== 'function')
    throw Error(
      formatErrorMessage(
        20,
        __DEV__ && 'The config.app on registerApplication must be an application or a loading function'
      )
    );
  const allowsStringAndFunction = (activeWhen) => typeof activeWhen === 'string' || typeof activeWhen === 'function';
  if (
    !allowsStringAndFunction(config.activeWhen) &&
    !(Array.isArray(config.activeWhen) && config.activeWhen.every(allowsStringAndFunction))
  )
    throw Error(
      formatErrorMessage(
        24,
        __DEV__ && 'The config.activeWhen on registerApplication must be a string, function or an array with both'
      )
    );
  if (!validCustomProps(config.customProps))
    throw Error(formatErrorMessage(22, __DEV__ && 'The optional config.customProps must be an object'));
}

function validCustomProps(customProps) {
  return (
    !customProps ||
    typeof customProps === 'function' ||
    (typeof customProps === 'object' && customProps !== null && !Array.isArray(customProps))
  );
}

/**
 * @description 校验并规范化参数
 */
function sanitizeArguments(appNameOrConfig, appOrLoadApp, activeWhen, customProps) {
  const usingObjectAPI = typeof appNameOrConfig === 'object';

  const registration = {
    name: null,
    loadApp: null,
    activeWhen: null,
    customProps: null,
  };

  if (usingObjectAPI) {
    // 校验参数合法
    validateRegisterWithConfig(appNameOrConfig);
    registration.name = appNameOrConfig.name;
    registration.loadApp = appNameOrConfig.app;
    registration.activeWhen = appNameOrConfig.activeWhen;
    registration.customProps = appNameOrConfig.customProps;
  } else {
    // 校验参数合法
    validateRegisterWithArguments(appNameOrConfig, appOrLoadApp, activeWhen, customProps);
    registration.name = appNameOrConfig;
    registration.loadApp = appOrLoadApp;
    registration.activeWhen = activeWhen;
    registration.customProps = customProps;
  }

  // 将loadApp转为函数
  registration.loadApp = sanitizeLoadApp(registration.loadApp);
  // 设置对象默认值
  registration.customProps = sanitizeCustomProps(registration.customProps);
  // 将activeWhen转为函数
  registration.activeWhen = sanitizeActiveWhen(registration.activeWhen);

  return registration;
}

function sanitizeLoadApp(loadApp) {
  if (typeof loadApp !== 'function') {
    return () => Promise.resolve(loadApp);
  }

  return loadApp;
}

function sanitizeCustomProps(customProps) {
  return customProps ? customProps : {};
}

function sanitizeActiveWhen(activeWhen) {
  let activeWhenArray = Array.isArray(activeWhen) ? activeWhen : [activeWhen];
  activeWhenArray = activeWhenArray.map((activeWhenOrPath) =>
    typeof activeWhenOrPath === 'function' ? activeWhenOrPath : pathToActiveWhen(activeWhenOrPath)
  );

  return (location) => activeWhenArray.some((activeWhen) => activeWhen(location));
}

export function pathToActiveWhen(path, exactMatch) {
  const regex = toDynamicPathValidatorRegex(path, exactMatch);

  return (location) => {
    // compatible with IE10
    let origin = location.origin;
    if (!origin) {
      origin = `${location.protocol}//${location.host}`;
    }
    const route = location.href.replace(origin, '').replace(location.search, '').split('?')[0];
    return regex.test(route);
  };
}

function toDynamicPathValidatorRegex(path, exactMatch) {
  let lastIndex = 0,
    inDynamic = false,
    regexStr = '^';

  if (path[0] !== '/') {
    path = '/' + path;
  }

  for (let charIndex = 0; charIndex < path.length; charIndex++) {
    const char = path[charIndex];
    const startOfDynamic = !inDynamic && char === ':';
    const endOfDynamic = inDynamic && char === '/';
    if (startOfDynamic || endOfDynamic) {
      appendToRegex(charIndex);
    }
  }

  appendToRegex(path.length);
  return new RegExp(regexStr, 'i');

  function appendToRegex(index) {
    const anyCharMaybeTrailingSlashRegex = '[^/]+/?';
    const commonStringSubPath = escapeStrRegex(path.slice(lastIndex, index));

    regexStr += inDynamic ? anyCharMaybeTrailingSlashRegex : commonStringSubPath;

    if (index === path.length) {
      if (inDynamic) {
        if (exactMatch) {
          // Ensure exact match paths that end in a dynamic portion don't match
          // urls with characters after a slash after the dynamic portion.
          regexStr += '$';
        }
      } else {
        // For exact matches, expect no more characters. Otherwise, allow
        // any characters.
        const suffix = exactMatch ? '' : '.*';

        regexStr =
          // use charAt instead as we could not use es6 method endsWith
          regexStr.charAt(regexStr.length - 1) === '/' ? `${regexStr}${suffix}$` : `${regexStr}(/${suffix})?(#.*)?$`;
      }
    }

    inDynamic = !inDynamic;
    lastIndex = index;
  }

  function escapeStrRegex(str) {
    // borrowed from https://github.com/sindresorhus/escape-string-regexp/blob/master/index.js
    return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  }
}
