/**
 * @description 卸载子应用的逻辑
 */
import {
  UNMOUNTING,
  NOT_MOUNTED,
  MOUNTED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { handleAppError, transformErr } from "../applications/app-errors.js";
import { reasonableTime } from "../applications/timeouts.js";

/**
 * @description 将app映射为unmountApp的promise
 */
export function toUnmountPromise(appOrParcel, hardFail) {
  return Promise.resolve().then(() => {
    // 如果app的状态不是已挂载，则不需要卸载
    if (appOrParcel.status !== MOUNTED) {
      return appOrParcel;
    }
    // 将app的状态改为卸载中
    appOrParcel.status = UNMOUNTING;

    const unmountChildrenParcels = Object.keys(
      appOrParcel.parcels
    ).map((parcelId) => appOrParcel.parcels[parcelId].unmountThisParcel());

    let parcelError;

    return Promise.all(unmountChildrenParcels)
      .then(unmountAppOrParcel, (parcelError) => {
        // There is a parcel unmount error
        return unmountAppOrParcel().then(() => {
          // Unmounting the app/parcel succeeded, but unmounting its children parcels did not
          const parentError = Error(parcelError.message);
          if (hardFail) {
            throw transformErr(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(parentError, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
      })
      .then(() => appOrParcel);

    function unmountAppOrParcel() {
      // 调用app、parcel的unmount周期函数
      // 经过下载的子应用，unmount周期函数一定是promise，所以不用判空
      // We always try to unmount the appOrParcel, even if the children parcels failed to unmount.
      return reasonableTime(appOrParcel, "unmount")
        .then(() => {
          // 如果卸载成功，将应用的状态改为未挂载
          // The appOrParcel needs to stay in a broken status if its children parcels fail to unmount
          if (!parcelError) {
            appOrParcel.status = NOT_MOUNTED;
          }
        })
        .catch((err) => {
          if (hardFail) {
            throw transformErr(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          } else {
            handleAppError(err, appOrParcel, SKIP_BECAUSE_BROKEN);
          }
        });
    }
  });
}
