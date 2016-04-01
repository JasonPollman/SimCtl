/**
 * @namespace AndroidEmulatorDevice
 */
'use strict';

var util          = require('util'),
    exec          = require('child_process').exec,
    spawn         = require('child_process').spawn,
    utils         = require('jpc-utils'),
    AndroidDevice = require(__dirname),
    Device        = require(__dirname, 'BaseDevice'),
    isBooting     = {};

/**
 * A iOS Simulator Controller Class<br>
 * Spawns, boots, shutdowns, and manages an iOS Simulator instance.
 * @constructor
 * @extends AndroidDevice
 */
var AndroidEmulatorDevice = function AndroidEmulatorDevice () {

    /**
     * The current AndroidEmulatorDevice instance
     * @type {AndroidEmulatorDevice}
     */
    var self = this;

    // Inherit from AndroidDevice
    AndroidDevice.apply(self, arguments);

    /**
     * @callback AndroidEmulatorDevice~eraseCallback
     * @param {Error|Null} err An error, if one exists
     */

     /**
      * Resets (erases) the device
      * @param {DeviceSession} session The DeviceSession associated with this device
      * @param {AndroidEmulatorDevice~eraseCallback=} done A callback for completion
      * @return {Promise<Error|Null>} An error if one occured
      */
    this.erase = function () {
    };

    /**
     * Kills the emulator process
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param  {Function=} done A callback for completion. No arguments passed.
     * @return {Promise}
     */
    this.shutdown = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            exec(AndroidDevice.SDK_COMMANDS.ADB_KILL_EMULATOR(self.serial), function () {
                resolve();
                done.call(self);
            });
        });
    };

    /**
     * @callback AndroidEmulatorDevice~bootComplete
     * @param {Error|Null} err An error, if one exists
     * @param {Boolean} booted True if the device successfully reached the booted state, false otherwise
     */

    /**
     * Starts the AVD
     * @param {AndroidEmulatorDevice~bootComplete=} done A callback, invoked once the device has been booted
     * @return {Promise<Error|Null> An error, if one occured
     */
    this.boot = function (options, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        if(typeof options !== 'object') options = { gpu: 'on', netspeed: 'full' };

        return new Promise(function (resolve, reject) {
            self.isLocked(function (locked) {
                if(!locked) {
                    self.isBooted(function (err, booted) {
                        if(err || !booted) {
                            isBooting[self.id] = true;

                            AndroidDevice.findFirstAvailablePort(function (err, port) {
                                if(err) {
                                    reject(err);
                                    done.call(self, err, null);
                                }
                                else {
                                    var args = ['-avd', self.avdId, '-port', port];
                                    options.each(function (o, k) {
                                        switch (k) {
                                            case 'gpu':
                                                args.push('-gpu', o === 'off' ? 'off' : 'on');
                                                break;

                                            case 'wipe':
                                                args.push('-wipe-data');
                                                break;

                                            case 'netspeed':
                                                if(o && typeof o === 'string') args.push('-netspeed', o);
                                                break;

                                            case 'proxy':
                                                if(o && typeof o === 'string') args.push('-http-proxy', o);
                                                break;
                                        }
                                    });

                                    var instance = spawn(AndroidDevice.EMULATOR_EXECUTABLE, args, { detached: true });
                                    AndroidDevice.waitForDeviceToFinishBooting('emulator-' + port, function (err) {
                                        if(err) {
                                            reject(err);
                                            done.call(self, err);
                                        }
                                        else {
                                            exec(AndroidDevice.SDK_COMMANDS.ADB_SHELL_SET_DEVICE_PROP('emulator-' + port, 'persist.sys.avd_name', self.avdId), function (err, stdout, stderr) {
                                                if(err || stderr) {
                                                    e = err || new Error(stderr);
                                                    reject(e);
                                                    done.call(self, e);
                                                }
                                                else {
                                                    self.isBooted(function (err, booted) {
                                                        isBooting[self.id] = false;

                                                        if(err || !booted) {
                                                            e = err || new Error('Failed to boot device!');
                                                            reject(e);
                                                            done.call(self, e);
                                                        }
                                                        else {
                                                            resolve(instance);
                                                            done.call(self, null, instance);
                                                        }
                                                    });
                                                }

                                            });
                                        }
                                    });
                                }
                            });
                        }
                        else {
                            e = isBooting[self.id] ? Device.DEVICE_NOT_READY_ERROR : Device.DEVICE_ALREADY_BOOTED_ERROR;
                            reject(e);
                            done.call(self, e, null);
                        }
                    });
                }
                else {
                    reject(Device.DEVICE_IS_LOCKED_ERROR);
                    done.call(self, Device.DEVICE_IS_LOCKED_ERROR, null);
                }
            });
        });
    };

    /**
    * @callback AndroidEmulatorDevice~simulatorDeviceStandardCallback
    * @param {Error|Null} err An error if one occured
    */

    /**
     * Locks (or unlocks) the device screen, using the application menu
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {AndroidEmulatorDevice~simulatorDeviceStandardCallback} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.lockScreen = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            self.performKeyEvent('KEYCODE_POWER', function (err) {
                if(err) {
                    reject(err);
                    done.call(self, err);
                }
                else {
                    resolve(null);
                    done.call(self, null);
                }
            });
        });
    };

    /**
     * Presses the device's home button, using the application menu
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {AndroidEmulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.pressHomeKey = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            self.performKeyEvent('KEYCODE_HOME', function (err) {
                if(err) {
                    reject(err);
                    done.call(self, err);
                }
                else {
                    resolve(null);
                    done.call(self, null);
                }
            });
        });
    };
};

util.inherits(AndroidEmulatorDevice, AndroidDevice);
module.exports = AndroidEmulatorDevice;
