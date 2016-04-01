/**
 * @namespace AndroidDevice
 */
'use strict';

var exec   = require('child_process').exec,
    util   = require('util'),
    utils  = require('jpc-utils'),
    path   = require('path'),
    fs     = require('fs'),
    Device = require(path.join(__dirname, '..', 'BaseDevice')),

    /**
     * A cached object with a list of running devices. If Date.now() - ADB_RUNNING_LAST < ADB_RUNNING_TIMEOUT, then
     * this cache will be returned rather than making a subsequent call to 'adb devices'
     * @type {Object}
     * @memberof AndroidDevice
     */
    ADB_RUNNING_CACHE = {},

    /**
     * Timestap of last call to 'adb devices'
     * @type {Number}
     * @memberof AndroidDevice
     */
    ADB_RUNNING_LAST = 0,

    /**
     * A queue of callbacks to invoke if 'adb devices' is called in a loop
     * @type {Array<Object>}
     * @memberof AndroidDevice
     */
    ADB_RUNNING_QUEUE = [],

    /**
     * A flag to indicate if we're currently walking the file system to check for simulators. If true, subsequent calls to AndroidDevice.getAllDevices
     * will be invoked with the same results as the initial caller.
     * @type {Boolean}
     * @memberof AndroidDevice
     */
    WALKING_SIMS = false,

    /**
     * A queue of callbacks to invoke if AndroidDevice.listRunningDevices is called in a loop
     * @type {Array<Object>}
     * @memberof AndroidDevice
     */
    SIM_DEVICE_QUEUE= [],

    /**
     * A flag to indicate if we're currently walking 'adb devices'. If true, subsequent calls to AndroidDevice.getAllDevices
     * will be invoked with the same results as the initial caller.
     * @type {Boolean}
     * @memberof AndroidDevice
     */
    ADB_RUNNING_WALKING = false,

    /**
     * A cached object with a list of available simulators. If Date.now() - AVD_DEVICES_LAST < AVD_DEVICES_TIMEOUT, then
     * this cache will be returned rather than making a subsequent call to the file system
     * @type {Object}
     * @memberof AndroidDevice
     */
    AVD_DEVICES_CACHE = {},

    /**
     * A cached object with a list of available simulators. If Date.now() - AVD_DEVICES_LAST < AVD_DEVICES_TIMEOUT, then
     * this cache will be returned rather than making a subsequent call to the file system
     * @type {Object}
     * @memberof AndroidDevice
     */
    AVD_DEVICES_CACHE_BY_AVD_ID = {},

    /**
     * Timestap of last call to the file system to scan for available AVD devices
     * @type {Number}
     * @memberof AndroidDevice
     */
    AVD_DEVICES_LAST = 0,

    /**
     * The amount of time in ms, that cache should be returned before re-scanning the file system to look for AVDs
     * @type {Number}
     * @memberof AndroidDevice
     */
    AVD_DEVICES_TIMEOUT = 3000,

    /**
     * The amount of time in ms, that cache should be returned before re-runing adb devices
     * @type {Number}
     * @memberof AndroidDevice
     */
    ADB_RUNNING_TIMEOUT = 3000,

    /**
     * How long should a device be given to completely boot before throwing an error?
     * @type {Number}
     * @memberof AndroidDevice
     */
    WAIT_FOR_BOOT_TIMEOUT = 180 * 1000, // 3 Minutes

    /**
     * The path to the Android SDK
     * @type {String}
     * @memberof AndroidDevice
     */
    ANDROID_SDK_HOME = process.env.ANDROID_SDK_HOME ? process.env.ANDROID_SDK_HOME : path.join(utils.USER_HOME, 'Library', 'Android', 'sdk'),

    /**
     * The path to the Android SDK abd executable
     * @type {String}
     * @memberof AndroidDevice
     */
    ANDROID_SDK_ADB = path.join(ANDROID_SDK_HOME, 'platform-tools', 'adb'),

    /**
     * The path to the Android SDK abd executable
     * @type {String}
     * @memberof AndroidDevice
     */
    ANDROID_SDK_AAPT = path.join(ANDROID_SDK_HOME, 'build-tools', '23.0.2', 'aapt'),

    /**
     * The path to the Android SDK emulator executable
     * @type {String}
     * @memberof AndroidDevice
     */
    ANDROID_SDK_EMULATOR = path.join(ANDROID_SDK_HOME, 'tools', 'emulator'),

    /**
     * The path to the Android SDK emulator executable
     * @type {String}
     * @memberof AndroidDevice
     */
    ANDROID_EMULATOR_HOME = process.env.ANDROID_AVD_HOME ?
        process.env.ANDROID_AVD_HOME : process.env.ANDROID_SDK_HOME ?
            path.join(process.env.ANDROID_SDK_HOME, '.android', 'avd') :
            path.join(utils.USER_HOME, '.android', 'avd'),

    /**
     * The preferred port to start an AVD on, if in use, the port will be incremented by 2 until an available one is found.
     * @type {Number}
     * @memberof AndroidDevice
     */
    STARTING_PORT = 5554,

    /**
     * A regular expression to parse the results of 'adb devices'
     * @type {RegExp}
     * @memberof AndroidDevice
     */
    PARSE_DAEMON_LIST = /^((?:emulator|device)-(\d{4}))\s*.*$/gm,

    /**
     * A semaphore to ensure that 'adb kill-server' is run only once.
     * @type {Boolean}
     * @memberof AndroidDevice
     */
    FIRST_RUN = true;


/**
 * A base Android device class. Both AndroidEmulatorDevice and AndroidPhysicalDevice inherit from this class
 * @param {String} name The device's name
 * @param {String} runtime The device's sdk version
 * @param {String} id The device's universal device identifier
 * @param {Boolean} isSimulator True if the device is a emulator, false if it's a physical device.
 * @constructor
 * @extends BaseDevice
 */
var AndroidDevice = function AndroidDevice () {
    var self          = this,
        orientation   = 0;

    // Inherit from the base device class
    Device.apply(this, arguments);

    /**
     * The device's OS
     * @type {String}
     */
    this.os = 'Android';

    /**
     * @callback AndroidDevice~isBootedCallback
     * @param {Error|Null} err An error if one occured
     * @param {Boolean} booted Whether or not the device is booted
     */

    /**
     * Determines whether or not the device is booted.<br>
     * @param {AndroidDevice~isBootedCallback} done A callback for completion
     * @return {Promise<Boolean|Error>} True if the device is booted, false otherwise
     */
    this.isBooted = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            AndroidDevice.listRunningDevices(function (err, avds) {
                self.serial = null;

                if(err) {
                    reject(err);
                    done.call(self, err, false);
                }
                else {
                    if(typeof avds[self.avdId] === 'object' && avds[self.avdId].booted === true) {
                        self.orientation = avds[self.avdId].orientation;
                        self.width       = avds[self.avdId].width;
                        self.height      = avds[self.avdId].height;
                        self.density     = avds[self.avdId].density;
                        self.serial      = avds[self.avdId].serial;
                        self.type        = avds[self.avdId].type;

                        resolve(true);
                        done.call(self, null, true);
                    }
                    else {
                        resolve(false);
                        done.call(self, null, false);
                    }
                }
            });
        });
    };

    /**
    * @callback AndroidEmulatorDevice~deviceStandardCallback
    * @param {Error|Null} err An error if one occured
    */

    /**
    * Rotates the device left
    * @param {DeviceSession} session The DeviceSession associated with this device
    * @param {AndroidEmulatorDevice~deviceStandardCallback=} done A callback for completion
    * @return {Promise<Error|Null> An error if one occured
    */
    this.rotateLeft = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var oo = orientation;
            orientation--;
            if(orientation < 0) orientation = 3;
            exec(AndroidDevice.SDK_COMMANDS.ADB_SET_ORIENTATION_TO(self.serial, orientation), function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    orientation = oo;
                    reject(e);
                    done.call(self, e);
                }
                else {
                    resolve();
                    done.call(self, null);
                }
            });
        });
    };

    /**
    * Rotates the device to the given orientation
    * @param {DeviceSession} session The DeviceSession associated with this device
    * @param {AndroidEmulatorDevice~deviceStandardCallback=} done A callback for completion
    * @return {Promise<Error|Null> An error if one occured
    */
    this.rotateTo = function (session, orientation, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof orientation !== 'string' || typeof orientation !== 'number') {
                e = new Error('Invalid orientation: ' + orientation);
                reject(e);
                done.call(self, e);
                return;
            }

            if(typeof orientation === 'string') orientation = Device.ORIENTATIONS.indexOf(orientation);
            if(orientation < 0 || orientation  > 3) orientation = 0;

            exec(AndroidDevice.SDK_COMMANDS.ADB_SET_ORIENTATION_TO(self.serial, orientation), function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    reject(e);
                    done.call(self, e);
                }
                else {
                    resolve();
                    done.call(self, null);
                }
            });
        });
    };

    /**
     * Rotates the device right
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {AndroidEmulatorDevice~deviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.rotateRight = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var oo = orientation;
            orientation++;
            if(orientation > 3) orientation = 0;
            exec(AndroidDevice.SDK_COMMANDS.ADB_SET_ORIENTATION_TO(self.serial, orientation), function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    orientation = oo;
                    reject(e);
                    done.call(self, e);
                }
                else {
                    resolve();
                    done.call(self, null);
                }
            });
        });
    };

    /**
     * @callback AndroidDevice~restartCallback
     * @param {Error|Null} err An error if one occured
     */

    /**
     * Reboots a device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param  {AndroidDevice~restartCallback} done A callback for completion
     * @return {Promise<Error|Null>} An error, if one occured
     */
    this.restart = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {

            // Reset the boot_completed device property
            exec(AndroidDevice.SDK_COMMANDS.ADB_SHELL_SET_DEVICE_PROP(self.serial, 'sys.boot_completed', '0'), function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    reject(e);
                    done.call(self, e);
                }
                else {

                    // Execute the command to restart the device
                    exec(AndroidDevice.SDK_COMMANDS.ADB_SHELL_REBOOT_DEVICE(self.serial), function (err, stdout, stderr) {
                        if(err || stderr) {
                            e = err || new Error(stderr);
                            reject(e);
                            done.call(self, e);
                        }
                        else {

                            // Wait for the device to completely boot to the home screen
                            AndroidDevice.waitForDeviceToFinishBooting(self.serial, function (err) {
                                if(err) {
                                    reject(err);
                                    done.call(self, err);
                                }
                                else {
                                    resolve();
                                    done.call(self, null);
                                }
                            });
                        }
                    });
                }
            });
        });
    };

    /**
     * @callback AndroidDevice~performKeyEventCallback
     * @param {Error|Null} err An error if one occured
     * @param {String} res Any output to the stdout from the exec all to 'adb '
     * @param {String|Null} res The results of the 'adb install' execution
     */

    /**
     * Sends keys to the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {String} apk The path to the APK to install
     * @param {AndroidDevice~performKeyEventCallback=} done A callback for completion
     * @return {Promise<Error|String>} An error, if one occured, or the exec results of the adb install command
     */
    this.performKeyEvent = function (session, keyEvent, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            exec(AndroidDevice.SDK_COMMANDS.ADB_SEND_KEY_EVENTS(self.serial, keyEvent), function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    reject(e);
                    done.call(AndroidDevice, e, null);
                }
                else {
                    resolve(stdout);
                    done.call(AndroidDevice, null, stdout);
                }
            });
        });
    };

    /**
     * @callback AndroidDevice~installCallback
     * @param {Error|Null} err An error if one occured
     * @param {String|Null} res The results of the 'adb install' execution
     */

    /**
     * Installs the given APK on the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {String} apk The path to the APK to install
     * @param {AndroidDevice~installCallback=} done A callback for completion
     * @return {Promise<Error|String>} An error, if one occured, or the exec results of the adb install command
     */
    this.install = function (session, apk, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof apk === 'string') {
                exec(AndroidDevice.SDK_COMMANDS.ADB_SHELL_INSTALL_APP(apk, self.serial), function (err, stdout, stderr) {
                    if(err || stdout) {
                        e = err || new Error(stderr);
                        reject(e);
                        done.call(self, e);
                    }
                    else {
                        resolve(stdout);
                        done.call(self, null, stdout);
                    }
                });
            }
            else {
                e = new Error('AndroidDevice.install expected argument #0 (bundle) to be a string, but got: ' + typeof bundle);
                reject(e);
                done.call(self, e);
            }
        });
    };

    /**
     * @callback AndroidDevice~uninstallCallback
     * @param {Error|Null} err An error if one occured
     * @param {String|Null} res The results of the 'adb uninstall' execution
     */

    /**
     * Uninstall the given APK on the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {String} apk The path to the APK to uninstall
     * @param {Function} done A callback for completion
     * @return {Promise<Error|String>} An error, if one occured, or the exec results of the adb install command
     */
    this.uninstall = function (session, apk, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof apk === 'string') {
                exec(AndroidDevice.SDK_COMMANDS.ADB_SHELL_UNINSTALL_APP(apk, self.serial), function (err, stdout, stderr) {
                    if(err || stdout) {
                        e = err || new Error(stderr);
                        reject(e);
                        done.call(self, e);
                    }
                    else {
                        resolve(stdout);
                        done.call(self, null, stdout);
                    }
                });
            }
            else {
                e = new Error('AndroidDevice.uninstall expected argument #0 (bundle) to be a string, but got: ' + typeof bundle);
                reject(e);
                done.call(self, e);
            }
        });
    };

    /**
     * @callback AndroidDevice~launchCallback
     * @param {Error|Null} err An error if one occured
     */

    /**
     * Launch an app on a device using the given bundle identifier.
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {String} bundle The name of the
     * @param  {AndroidDevice~launchCallback} done A callback for completion
     * @return {Promise<Error|Null>} An error, if one occured while attempting to launch the bundle
     */
    this.launch = function (session, bundle, isAPK, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        if(typeof isAPK !== 'boolean') isAPK = false;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof bundle !== 'string') {
                e = new Error('AndroidDevice.launch expected argument #0 (bundle) to be a string, but got: ' + typeof bundle);
                reject(e);
                done.call(self, e);
            }
            else {
                var onAPKResolution = function (resolvedBundleIdentifier) {
                    exec(AndroidDevice.SDK_COMMANDS.ADB_SHELL_LAUNCH_APP(self.serial, resolvedBundleIdentifier), function (err, stdout, stderr) {
                        if(err || stderr) {
                            e = err || new Error(stderr);
                            reject(e);
                            done.call(self, e);
                        }
                        else if(/\*\* No activities found to run, monkey aborted\./.test(stdout)) {
                            e = new Error('No bundle with the identifier "' + resolvedBundleIdentifier + '" found. Launch failed.');
                            reject(e);
                            done.call(self, e);
                        }
                        else {
                            resolve();
                            done.call(self, null);
                        }
                    });
                };

                // User has passed in an APK file, get the identifier from the APK file.
                if(isAPK) {
                    AndroidDevice.getBundleIdentifierForAPK(bundle, function (err, identifier) {
                        if(err) {
                            reject(err);
                            done.call(self, err);
                        }
                        else {
                            onAPKResolution(identifier);
                        }
                    });
                }
                // User has passed a string bundle identifier, directly call onAPKResolution with it.
                else {
                    onAPKResolution(bundle);
                }
            }
        });
    };

    /**
     * Returns the device's orientation
     * @return {String} The device's orientation as a string description
     */
    this.getOrientation = function () {
        return Device.ORIENTATIONS[self.orientation || 0];
    };
};

Object.defineProperties(AndroidDevice, {
    /**
     * Expose the AndroidEmulatorDevice from this object.
     * @memberof AndroidDevice
     * @type {AndroidEmulatorDevice}
     */
    Emulator: {
        configurable : false,
        enumerable   : false,
        get          : function () {
            return require(__dirname, 'Emulator');
        }
    },

    /**
     * Expose the AndroidPhysicalDevice from this object.
     * @memberof AndroidDevice
     * @type {AndroidPhysicalDevice}
     */
    Physical: {
        configurable : false,
        enumerable   : false,
        get          : function () {
            return require(__dirname, 'Physical');
        }
    }
});


/**
 * Expose the emulator executable path for subclasses to use/
 * @type {String}
 */
AndroidDevice.EMULATOR_EXECUTABLE = ANDROID_SDK_EMULATOR;

/**
 * The platform of the devices
 * @type {String}
 */
AndroidDevice.PLATFORM = 'Android';

/**
 * A list of commands used by the Android devices
 * @type {Object<String>}
 */
AndroidDevice.SDK_COMMANDS = {
    ADB_GET_USED_PORTS          : ANDROID_SDK_ADB + ' devices;',
    ADB_GET_RUNNING_DEVICES     : ANDROID_SDK_ADB + ' devices;',

    /**
     * Get's the serial identifier for the AVD with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_AVD_ID: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell getprop persist.sys.avd_name; ';
    },

    /**
     * Get's the screen dimensions for the AVD with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_SIZE: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell wm size; ';
    },

    /**
     * Get's the screen density for the AVD with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_DENSITY: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell wm density; ';
    },

    /**
     * Get's a device property for the AVD with the given serial
     * @param {String} serial The serial of the AVD device
     * @param {String} property The name of the property to get
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_PROP: function (serial, property) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell getprop ' + property + '; ';
    },

    /**
     * Set a device property for the AVD with the given serial
     * @param {String} serial The serial of the AVD device
     * @param {String} property The name of the property to set
     * @param {String} value The value to set the propert to
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_SET_DEVICE_PROP: function (serial, property, value) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell setprop ' + property + ' ' + ((value !== null && value !== undefined) ? value.toString() : '') + '; ';
    },

    /**
     * Determine if the device with the given serial has finished booting
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_IS_BOOTED: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell getprop sys.boot_completed; ';
    },

    /**
     * Get the orientation of the device with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_ORIENTATION: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell dumpsys input | grep SurfaceOrientation; ';
    },

    /**
     * Get the model (type) of the device with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_GET_DEVICE_TYPE: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell cat /system/build.prop | grep \'ro.product.device=\'; ';
    },

    /**
     * Reboot the device with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_REBOOT_DEVICE: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell stop; ' + ANDROID_SDK_ADB + ' -s ' + serial + ' shell start; ';
    },

    /**
     * Launch an app on the device with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_LAUNCH_APP: function (serial, pkg) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell monkey -p ' + pkg + ' -c android.intent.category.LAUNCHER\ 1 ';
    },

    /**
     * Install an APK on the device with the given serial
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_INSTALL_APP: function (serial, apk) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' install -r ' + apk + '; ';
    },

    /**
     * Turn off accelerometer rotation
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SET_ACCELEROMETER_ROTATION_OFF: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' shell content insert --uri content://settings/system --bind name:s:accelerometer_rotation --bind value:i:0; ';
    },

    /**
     * Sets the device's orientation. For this to work the ADB_SET_ACCELEROMETER_ROTATION_OFF command must be run prior (only once)
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SET_ORIENTATION_TO: function (serial, rotation) {
        return AndroidDevice.SDK_COMMANDS.ADB_SET_ACCELEROMETER_ROTATION_OFF(serial) + ANDROID_SDK_ADB + ' -s ' + serial + ' shell content insert --uri content://settings/system --bind name:s:user_rotation --bind value:i:' + rotation + '; ';
    },

    /**
     * Uninstall an APK on the device with the given serial
     * @param {String} serial The serial of the AVD device
     * @param {String} apk The APK name to uninstall
     * @return {String} The derived command, ready for execution
     */
    ADB_SHELL_UNINSTALL_APP: function (serial, apk) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' uninstall ' + apk + '; ';
    },

    /**
     * Kill the emulator at the given serial port
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_KILL_EMULATOR: function (serial) {
        return ANDROID_SDK_ADB + ' -s ' + serial + ' emu kill; ';
    },

    /**
     * Send a key event to the device
     * @param {String} serial The serial of the AVD device
     * @return {String} The derived command, ready for execution
     */
    ADB_SEND_KEY_EVENTS: function (serial, keyEvents) {
        if(!(keyEvents instanceof Array)) keyEvents = [keyEvents];

        var cmd = '';
        keyEvents.each(function (k) {
            if(typeof k === 'string') cmd += ANDROID_SDK_ADB + ' -s ' + serial + ' shell input keyevent ' + k + '; ';
        });

        return cmd;
    },

    /**
     * Get the bundle identifier for the given APK
     * @param {String} apk The name of the APK to get the bundle identifier for
     * @return {String} The derived command, ready for execution
     */
    AAPT_DUMP_APK_BADGING_FOR_APK: function (apk) {
        return ANDROID_SDK_AAPT + ' dump badging ' + apk + ' | grep package:\\ name ';
    }
};

/**
 * @callback AndroidDevice~getBundleIdentifierForAPKCallback
 * @param {Error|Null} err An error if one occured
 * @param {String} bundleIdentifier The bundle identifier of the APK
 */

/**
 * Get the bundle identifier for the given APK
 * @param {String} apk The name of the APK to get the bundle identifier for
 * @param {getBundleIdentifierForAPKCallback=} done A callback for completion
 * @return {Promise<Error|String>} The bundle identifier of the provided APK, or an error if one occured.
 */
AndroidDevice.getBundleIdentifierForAPK = function (apkPath, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        if(typeof apkPath === 'string') {
            exec(AndroidDevice.SDK_COMMANDS.AAPT_DUMP_APK_BADGING_FOR_APK, function (err, stdout, stderr) {
                if(err || stderr) {
                    reject(err || new Error(stderr));
                    done.call(AndroidDevice, err, null);
                }
                else {
                    var badging = stdout.trim().match(/^package: *name='([a-zA-Z0-9_\-\.]+?)' versionCode/);
                    if(badging instanceof Array && badging[1]) {
                        resolve(badging[1]);
                        done.call(AndroidDevice, null, badging[1]);
                    }
                    else {
                        e = new Error('Unable to dump badging for APK "' + apkPath + '"');
                        reject(e);
                        done.call(AndroidDevice, e, null);
                    }
                }
            });
        }
        else {
            e = new Error('AndroidDevice.waitForDeviceToFinishBooting expected argument #0 (port) to be a string, but got: ' + typeof apkPath);
            reject(e);
            done.call(AndroidDevice, e, null);
        }
    });
};

var executeQueue = function (err, res) {
    ADB_RUNNING_QUEUE.each(function (o) {
        if(err) {
            o.reject(err);
            o.done.call(AndroidDevice, err, null);
        }
        else {
            o.resolve(res);
            o.done.call(AndroidDevice, null, res);
        }
    });
    ADB_RUNNING_WALKING = false;
    ADB_RUNNING_QUEUE = [];
};

/**
 * @callback AndroidDevice~listRunningDevicesCallback
 * @param {Error|Null} err An error, if one occured
 * @param {Object} runningDevices An object containing the properites of each running device
 */

/**
 * Gets an object with the running devices and their properties
 * @param  {Function} done A callback for completion
 * @return {Promise<Error|Object>} An error if one occured, or an object with each running device's properties
 */
AndroidDevice.listRunningDevices = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        var onServerKilled = function () {
            if(!ADB_RUNNING_WALKING || Date.now() - ADB_RUNNING_LAST > ADB_RUNNING_TIMEOUT) {
                ADB_RUNNING_WALKING = true;
                ADB_RUNNING_LAST    = Date.now();
                ADB_RUNNING_CACHE   = {};

                ADB_RUNNING_QUEUE.push({ resolve: resolve, reject: reject, done: done });
                exec(AndroidDevice.SDK_COMMANDS.ADB_GET_RUNNING_DEVICES, function (err, stdout, stderr) {
                    if(err || stderr) {
                        e = err || new Error(stderr);
                        executeQueue(e, null);
                    }
                    else {
                        var serials = [], deviceObjects = {}, commands = ['', '', '', '', '', ''], m;
                        while(m = PARSE_DAEMON_LIST.exec(stdout.trim())) serials.push(m[1]); // jshint ignore:line

                        if(serials.length > 0) {
                            serials.each(function (s) {
                                commands[0] += AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_AVD_ID(s);
                                commands[1] += AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_SIZE(s);
                                commands[2] += AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_DENSITY(s);
                                commands[3] += AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_ORIENTATION(s);
                                commands[4] += AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_IS_BOOTED(s);
                                commands[5] += AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_TYPE(s);
                            });

                            var total   = commands.length, count = 0, ids = [], sizes = [], densities = [], orientations = [], booted = [], types = [], error = null,
                                onTotal = function () {
                                    if(error) {
                                        executeQueue(error, null);
                                    }
                                    else {
                                        serials.each(function (s, k, i) {
                                            if(ids[i].trim() === 'NULL') {
                                                AndroidDevice.getAVDPIDOfDeviceOnPort(s.replace(/^.*-(\d_)$/, '$1'), function (err, pid) {
                                                    if(!err && !isNaN(parseInt(pid, 10))) process.kill(pid, 'SIGINT');
                                                });
                                            }
                                            else {
                                                sizes[i] = sizes[i].split(/x/);
                                                var id = ids[i].trim();

                                                deviceObjects[id] = {
                                                    id          : id.trim(),
                                                    serial      : s,
                                                    booted      : parseInt(booted[i].trim(), 10) === 1 ? true : false,
                                                    width       : parseInt(sizes[i][0],      10),
                                                    height      : parseInt(sizes[i][1],      10),
                                                    density     : parseInt(densities[i],     10),
                                                    orientation : parseInt(orientations[i],  10),
                                                    type        : types[i].trim()
                                                };
                                            }
                                        });

                                        ADB_RUNNING_CACHE = deviceObjects;
                                        executeQueue(null, ADB_RUNNING_CACHE);
                                    }
                                };

                            // Get each device's identifier
                            exec(commands[0], function (err, stdout, stderr) {
                                if(err || stderr) {
                                    error = err || new Error(stderr);
                                }
                                else {
                                    ids = stdout.replace(/^\r\n$/gm, 'NULL\n').trim().split('\n');
                                }
                                if(++count === total) onTotal();
                            });

                            // Get each device's size
                            exec(commands[1], function (err, stdout, stderr) {
                                if(err || stderr) {
                                    error = err || new Error(stderr);
                                }
                                else {
                                    sizes = stdout.trim().replace(/^ *Physical size:\s*(.*)\r*/gm, '$1').split('\n');
                                }
                                if(++count === total) onTotal();
                            });

                            // Get each device's density
                            exec(commands[2], function (err, stdout, stderr) {
                                if(err || stderr) {
                                    error = err || new Error(stderr);
                                }
                                else {
                                    densities = stdout.trim().replace(/^ *Physical density:\s*(.*)\r*/gm, '$1').split('\n');
                                }
                                if(++count === total) onTotal();
                            });

                            // Get each device's orientation
                            exec(commands[3], function (err, stdout, stderr) {
                                if(err || stderr) {
                                    error = err || new Error(stderr);
                                }
                                else {
                                    orientations = stdout.trim().replace(/^ *SurfaceOrientation:\s*(\d)\r*/gm, '$1').split('\n');
                                }
                                if(++count === total) onTotal();
                            });

                            // Get each device's orientation
                            exec(commands[4], function (err, stdout, stderr) {
                                if(err || stderr) {
                                    error = err || new Error(stderr);
                                }
                                else {
                                    booted = stdout.trim().replace(/^ *(\d)\r*/gm, '$1').split('\n');
                                }
                                if(++count === total) onTotal();
                            });

                            // Get each device's orientation
                            exec(commands[5], function (err, stdout, stderr) {
                                if(err || stderr) {
                                    error = err || new Error(stderr);
                                }
                                else {
                                    types = stdout.trim().replace(/^ *ro.product.device=(.*)\r*/gm, '$1').split('\n');
                                }
                                if(++count === total) onTotal();
                            });
                        }
                        else {
                            executeQueue(null, {});
                        }
                    }
                });
            }
            else {
                if(!ADB_RUNNING_WALKING) {
                    resolve(ADB_RUNNING_CACHE);
                    done.call(AndroidDevice, null, ADB_RUNNING_CACHE);
                }
                else {
                    ADB_RUNNING_QUEUE.push({ resolve: resolve, reject: reject, done: done });
                }
            }
        };

        if(FIRST_RUN === true) {
            exec(AndroidDevice.ADB_KILL_SERVER, function () {
                FIRST_RUN = false;
                onServerKilled();
            });
        }
        else {
            onServerKilled();
        }
    });
};

/**
 * @callback AndroidDevice~getUsedPortsCallback
 * @param {Error|Null} err An error, if one occured
 * @param {Array<Number>} usedPorts A list of ports currently in use
 */

/**
 * Finds all the consumed ports being used by AVD devices
 * @param  {AndroidDevice~getUsedPortsCallback=} done A callback for completion
 * @return {Promise<Error|Array>} A list of ports currently in use, or an error if one occured.
 */
AndroidDevice.getUsedPorts = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        exec(AndroidDevice.SDK_COMMANDS.ADB_GET_USED_PORTS, function (err, stdout, stderr) {
            if(err || stderr) {
                reject(err || new Error(stderr));
                done.call(AndroidDevice, err, null);
            }
            else {
                var usedPorts = [], m;
                while(m = PARSE_DAEMON_LIST.exec(stdout.trim())) usedPorts.push(parseInt(m[2], 10)); // jshint ignore:line
                resolve(usedPorts);
                done.call(AndroidDevice, null, usedPorts);
            }
        });
    });
};

/**
 * @callback AndroidDevice~waitForDeviceToFinishBootingCallback
 * @param {Error|Null} err An error, if one occured
 */

/**
 * Blocks the device until a device has finished booting.
 * @param {Number} timeout A optional timeout. If unspecified, AndroidDevice~WAIT_FOR_BOOT_TIMEOUT will be used.
 * @param {AndroidDevice~waitForDeviceToFinishBootingCallback=} done A callback for completion
 * @return {Promise<Error>} An error, if one occured.
 */
AndroidDevice.waitForDeviceToFinishBooting = function (serial, timeout, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    if(typeof timeout !== 'number') timeout = WAIT_FOR_BOOT_TIMEOUT;
    var start = Date.now(), e;

    return new Promise(function (resolve, reject) {
        if(typeof serial === 'string') {
            AndroidDevice.listRunningDevices(function () {
                var command = AndroidDevice.SDK_COMMANDS.ADB_SHELL_GET_DEVICE_IS_BOOTED(serial);
                exec(command, function waitForBoot (err, stdout) {
                    if(stdout.trim().replace('\r') == '1') { // jshint ignore:line
                        resolve(null);
                        done.call(AndroidDevice, null);
                    }
                    else if(Date.now() - start < timeout) {
                        exec(command, waitForBoot);
                    }
                    else {
                        e = err || new Error('Device boot time has exceeded the boot timeout');
                        reject(e);
                        done.call(AndroidDevice, e);
                    }
                });
            });
        }
        else {
            e = new Error('AndroidDevice.waitForDeviceToFinishBooting expected argument #0 (serial) to be a string, but got: ' + typeof serial);
            reject(e);
            done.call(AndroidDevice, e);
        }
    });
};

/**
 * @callback AndroidDevice~findFirstAvailablePortCallback
 * @param {Error|Null} err An error, if one occured
 * @param {Array<Number>} usedPorts A list of ports currently in use
 */

/**
 * Find the first available port to start the AVD device on
 * @param  {AndroidDevice~findFirstAvailablePortCallback=} done A callback for completion
 * @return {Promise<Number|Error>} The available port to start the device on, or an error, if one occured.
 */
AndroidDevice.findFirstAvailablePort = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        AndroidDevice.getUsedPorts()
            .then(function (ports) {
                var port = STARTING_PORT;
                while(ports.indexOf(port) > -1) port += 2;

                if(port > 5680) {
                    var e = new Error('Too many emulators ports in use — no available ports!');
                    reject(e);
                    done.call(AndroidDevice, e, null);
                }
                else {
                    resolve(port);
                    done.call(AndroidDevice, null, port);
                }
            })
            .catch(function (e) {
                reject(e);
                done.call(AndroidDevice, e, null);
            });
    });
};

/**
 * Generates an AndroidEmulatorDevice from the given emulator config.ini file
 * @param {String} contents The emulator's config.ini file contents
 * @memberof AndroidDevice
 * @return {AndroidEmulatorDevice|null} emulator The AndroidEmulatorDevice object or null
 */
function generateEmulatorObjectFromIni (contents) {
    var Emulator = require(path.join(__dirname, 'Emulator')),
        AvdId    = contents.match(/^AvdId=(.*)$/m),
        AvdName  = contents.match(/^avd\.ini\.displayname=(.*)$/m),
        avdId, name, emulator, id;

    if(AvdId instanceof Array && typeof AvdId[1] === 'string')     avdId = AvdId[1];
    if(AvdName instanceof Array && typeof AvdName[1] === 'string') name  = AvdName[1];
    id = avdId;

    if(name && avdId) {
        emulator = Device.DEVICES[id] ? Device.DEVICES[id] : new Emulator(name, null, id, true);
        emulator.avdId = avdId;
        return emulator;
    }
    return null;
}

/**
 * @callback AndroidDevice~getAvailableSimulatorsCallback
 * @param {Error|Null} err An error, if one occured
 * @param {Object<AndroidEmulatorDevice>} devices The available AVDs on the system
 */

/**
 * Gets the system's available AVD devices, and provides an object with AndroidEmulatorDevice keyed by a device id.
 * @param  {AndroidDevice~getAvailableSimulatorsCallback=} done [description]
 * @return {Promise<Error|Object>} The available AVDs on the system or an error, if one occured.
 */
AndroidDevice.getAvailableSimulators = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        if(!WALKING_SIMS || Date.now() - AVD_DEVICES_LAST > AVD_DEVICES_TIMEOUT) {
            WALKING_SIMS                = true;
            AVD_DEVICES_LAST            = Date.now();
            AVD_DEVICES_CACHE           = {};
            AVD_DEVICES_CACHE_BY_AVD_ID = {};

            var emulators = {}, emulatorsByAVDId = {};
            SIM_DEVICE_QUEUE.push({ resolve: resolve, reject: reject, done: done });

            // Read the contents of the Android AVD directory
            fs.readdir(ANDROID_EMULATOR_HOME, function (err, files) {
                if(err) {
                    SIM_DEVICE_QUEUE.each(function (o) {
                        o.reject(err);
                        o.done.call(AndroidDevice, err, null);
                    });

                    SIM_DEVICE_QUEUE = [];
                    WALKING_SIMS     = false;
                }
                else {
                    var total = files.length, inspected = 0;

                    /**
                     * Increments the total number of files checked and invokes the promise resolution and callback if
                     * the total is equal to the numer of files inspected
                     * @return {undefined}
                     */
                    var incrementAndCheckTotal = function () {
                        if(++inspected === total) {
                            AVD_DEVICES_CACHE           = emulators;
                            AVD_DEVICES_CACHE_BY_AVD_ID = emulatorsByAVDId;
                            SIM_DEVICE_QUEUE.each(function (o) {
                                o.reject(emulators);
                                o.done.call(AndroidDevice, null, emulators, emulatorsByAVDId);
                            });

                            SIM_DEVICE_QUEUE = [];
                            WALKING_SIMS     = false;
                        }
                    };

                    // Walk through all the files in the Android AVD directory
                    files.each(function (f) {
                        var absolutePath = path.resolve(ANDROID_EMULATOR_HOME, f);

                        // Emulators have a .avd directory
                        if(path.extname(f) === '.avd') {
                            fs.stat(absolutePath, function (err, stat) {
                                if(!err && stat.isDirectory()) {
                                    fs.readFile(path.join(absolutePath, 'config.ini'), function (err, contents) {
                                        if(!err) {

                                            // Generate a new AndroidEmulatorDevice object
                                            var emu = generateEmulatorObjectFromIni(contents.toString('utf-8'));
                                            if(emu) {

                                                // Read the [emulator name].ini file to get the API version the emulator is using
                                                fs.readFile(path.join(absolutePath, '..', emu.avdId + '.ini'), function (err, contents) {
                                                    if(!err) {
                                                        var sdk = contents.toString('utf-8').match(/target=.*:.*:(\d+)/);
                                                        if(sdk instanceof Array && typeof sdk[1] === 'string') emu.sdk = emu.apiLevel = sdk[1];
                                                        emulators[emu.id] = emulatorsByAVDId[emu.avdId] = emu;
                                                    }
                                                    incrementAndCheckTotal();
                                                });
                                            }
                                            else { incrementAndCheckTotal(); }
                                        }

                                        else { incrementAndCheckTotal(); }
                                    });
                                }
                                else { incrementAndCheckTotal(); }
                            });
                        }
                        else { incrementAndCheckTotal(); }
                    });
                }
            });
        }
        else {
            if(!WALKING_SIMS) {
                resolve(AVD_DEVICES_CACHE);
                done.call(AndroidDevice, null, AVD_DEVICES_CACHE, AVD_DEVICES_CACHE_BY_AVD_ID);
            }
            else {
                SIM_DEVICE_QUEUE.push({ resolve: resolve, reject: reject, done: done });
            }
        }
    });
};

/**
 * @callback AndroidDevice~generateDeviceObjectsCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<Object>} emulators A list of emulators and their properties
 */

/**
 * Return the list of available Android devices
 * @param {AndroidDevice~generateDeviceObjectsCallback=} done A callback for completion
 * @return Promise<Error|Array> An array of AndroidEmulatorDevices and AndroidPhysicalDevices or an error if one occured.
 */
AndroidDevice.getAvailableDevices = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        AndroidDevice.getAllDevices(function (err, devices) {
            if(err) {
                reject(err);
                done.call(AndroidDevice, err, []);
            }
            else {
                var count = 0, total = devices.length, available = [];
                devices.each(function (d) {
                    d.isAvailable(function (a) {
                        if(a) available.push(d);
                        if(++count === total) {
                            resolve(available);
                            done.call(AndroidDevice, null, available);
                        }
                    });
                });
            }
        });
    });
};

/**
 * @callback
 * @param {Array<AndroidPhysicalDevices>} An array of available physical devices
 * @param {Object<AndroidEmulatorDevices>} An object containing the list of AVD devices
 * @param {Function} resolve The resolve function to be called
 * @param {Function} done The callback to be invoked
 * @memberof AndroidDevice
 */
function completeDiscovery (devices, simulators, resolve, done) {
    devices = devices.concat(simulators.makeArray());
    resolve(devices);
    done.call(AndroidDevice, null, devices);
}

/**
 * Return the full list of Android devices
 * @param {AndroidDevice~generateDeviceObjectsCallback=} done A callback for completion
 * @return Promise<Error|Array> An array of iOSSimulatorDevices and iOSPhysicalDevices or an error if one occured.
 */
AndroidDevice.getAllDevices = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var allDevices     = [],
        PhysicalDevice = require(__dirname, 'Physical');

    return new Promise(function (resolve, reject) {
        AndroidDevice.listRunningDevices(function (err, devices) {
            if(err) {
                reject(err);
                done.call(AndroidDevice, err, []);
            }
            else {
                AndroidDevice.getAvailableSimulators(function (err, simulators, simulatorsByAVDId) {
                    if(err) {
                        reject(err);
                        done.call(AndroidDevice, err, []);
                    }
                    else {
                        var total = devices.members(), count = 0;
                        if(total > 0) {
                            devices.each(function (d) {
                                if(!simulatorsByAVDId[d.id]) {
                                    var phy = new PhysicalDevice(d.id.replace(/_/g, ' '), null, d.id.md5, false, 'Android');
                                    phy.isBooted(function () {
                                        allDevices.push(phy);
                                        if(++count === total)
                                            completeDiscovery(allDevices, simulatorsByAVDId, resolve, done);
                                    });
                                }
                                else if(++count === total) {
                                    completeDiscovery(allDevices, simulatorsByAVDId, resolve, done);
                                }
                            });
                        }
                        else {
                            var sims = simulators.makeArray();
                            resolve(sims);
                            done.call(AndroidDevice, null, sims);
                        }
                    }
                });
            }
        });
    });
};

/**
 * @callback AndroidDevice~getDevicesCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<AndroidEmulatorDevice|AndroidPhysicalDevice>} A list of the emulators with the given name
 */

/**
 * Get a device using a the device name
 * @param {String} name The name of the device
 * @param {Boolean=} refresh Force a refresh and ignore cached results
 * @param {AndroidDevice~getDevicesCallback=} done A callback for completion
 * @return {Promise<Error|Array>}
 */
AndroidDevice.getDevicesWithName = function (name, refresh, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    if(typeof refresh !== 'boolean') refresh = false;

    return new Promise(function (resolve, reject) {
        AndroidDevice.getAllDevices(refresh, function (err, devices) {
            if(err) {
                reject(err);
                done.call(AndroidDevice, err);
            }
            else {
                var devicesWithName = [];
                devices.each(function (d) {
                    if(d.name === name) devicesWithName.push(d);
                });
                resolve(devicesWithName);
                done.call(AndroidDevice, null, devicesWithName);
            }
        });
    });
};

/**
 * Get a device using a the device name
 * @param {String} name The name of the device
 * @param {Boolean=} refresh Force a refresh and ignore cached results
 * @param {AndroidDevice~getDevicesCallback=} done A callback for completion
 * @return {Promise<Error|Array>}
 */
AndroidDevice.getDeviceWithId = function (id, refresh, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    if(typeof refresh !== 'boolean') refresh = false;

    return new Promise(function (resolve, reject) {
        AndroidDevice.getAllDevices(refresh, function (err, devices) {
            if(err) {
                reject(err);
                done.call(AndroidDevice, err);
            }
            else {
                var device = null;
                devices.each(function (d) {
                    if(d.id === id) {
                        device = d;
                        return false;
                    }
                });

                resolve(device);
                done.call(AndroidDevice, null, device);
            }
        });
    });
};

/**
 * @callback AndroidDevice~getAVDPIDOfDeviceOnPortCallback
 * @param {Error|Null} error An error if on occured.
 * @param {String|Number} The pid of the emulator on the given port or null
 */

/**
 * Resolves the process id for the emulator on the given port
 * @param {String|Number} port The port to get the pid for
 * @param {AndroidDevice~getAVDPIDOfDeviceOnPortCallback=} done A callback for completion
 * @return {Promise<Error|String|Number>} The pid of the emulator on the given port or null
 */
AndroidDevice.getAVDPIDOfDeviceOnPort = function (port, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    if(typeof port !== 'string' || typeof port !== 'number') port = 5554;

    return new Promise(function (resolve, reject) {
        exec('lsof -i :' + port.toString() + ' | grep emu.*; ', function (err, stdout, stderr) {
            if(err || stderr || !stdout) {
                e = err || new Error(stderr);
                reject(e);
                done.call(AndroidDevice, e, null);
            }
            else {
                var pid = stdout.match(/^emulator(?:.*?) (\d+) .*/);
                if(pid instanceof Array && pid[1]) {
                    resolve(pid[1]);
                    done.call(AndroidDevice, null, pid[1]);
                }
                else {
                    resolve(null);
                    done.call(AndroidDevice, null, null);
                }
            }
        });
    });
};


util.inherits(AndroidDevice, Device);
module.exports = AndroidDevice;
