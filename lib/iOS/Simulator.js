/**
 * @namespace iOSSimulatorDevice
 */
'use strict';

var path      = require('path'),
    util      = require('util'),
    exec      = require('child_process').exec,
    spawn     = require('child_process').spawn,
    utils     = require('jpc-utils'),
    iOSDevice = require(__dirname),
    isBooting = {};

/**
 * A iOS Simulator Controller Class<br>
 * Spawns, boots, shutdowns, and manages an iOS Simulator instance.
 * @constructor
 * @extends iOSDevice
 */
var iOSSimulatorDevice = function iOSSimulatorDevice () {

        /**
         * The current iOSSimulatorDevice instance
         * @type {iOSSimulatorDevice}
         */
    var self = this,

        /**
         * The spawned Simulator process ChildProcess instance
         * @type {ChildProcess}
         */
        simProcess  = null,

        /**
         * The current device orientation as an integer. Use iOSSimulatorDevice.getOrientation to get the device's orientation.
         * @type {Number}
         */
        orientation = 0,

        /**
         * Sets the name of the Simulator process named based on the device's SDK version
         * @type {String}
         */
        simulatorProcessName = self.runtime < 9.0 ? 'iOS\ Simulator' : 'Simulator';

    // Inherit from iOSDevice
    iOSDevice.apply(self, arguments);

    /**
     * Determines whether or not the device is booted.<br>
     * Note, this method makes a call to 'xcrun simctl' to ensure the results are accurate.
     * @return {Promise<Boolean|Error>} True if the device is booted, false otherwise
     */
    this.isBooted = function () {
        var done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve) {
            iOSDevice.getSimulatorDeviceStatuses(function (err, devices) {
                var booted = !(err || !devices[self.udid] || devices[self.udid].status === false);
                resolve(booted);
                done.call(self, err, booted);
            });
        });
    };

    /**
     * @callback iOSSimulatorDevice~JXAExecutionComplete
     * @param {Error|Null} err An error, if one was returned by the exec call.
     * @param {String} stdout The stdout results of the execution.
     */

    /**
     * Executes the given JXA Command.
     * This requries that the user has allowed Terminal to control their machine (Settings > Security > Privacy)
     * @param {String} command The JXA command to execute
     * @param {iOSSimulatorDevice~JXAExecutionComplete} done A callback for completion
     * @return {undefined}
     */
    function executeJXACommand (command, done) {
        done    = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        command = 'osascript -l JavaScript -e "' + command + '"';

        exec(command, function (err, stdout, stderr) {
            return (err || stderr) ? done.call(err || new Error(stderr)) : done.call(iOSDevice, stdout);
        });
    }

    /**
     * Waits for a device to have a booted status before returning, for a maximum of 10 attempts. Attempts are
     * made at 1 second intervals.
     * @param  {Number} attempts The number of attempts to check for a booted status before returning false.
     * @param  {iOSSimulatorDevice~waitForBootComplete} done The callback to invoke when the device is finished booted, or if the boot fails.
     * @param  {Number=} attempt The current attempt count; for resursive purposes only
     * @return {undefined}
     */
    function waitForBoot (attempts, done, attempt) {
        attempt = attempt || 0;
        self.isBooted(function (err, booted) {
            if(attempt < attempts) {
                if(!err && booted) {
                    done.call(self, null, true);
                }
                else {
                    setTimeout(function () {
                        waitForBoot(attempts, done, ++attempt);
                    }, 1000);
                }
            }
            else {
                done.call(self, err, false);
            }
        });
    }

    /**
     * @callback iOSSimulatorDevice~getEnvironmentVariableCallback
     * @param {Error|Null} err An error, if one exists
     * @param {Object<String>} value The values of the environment variable as key/value pairs
     */

    /**
     * Get an environment variable from the device
     * @param  {String} variableName The name of the environment variable to get
     * @param  {iOSSimulatorDevice~getEnvironmentVariableCallback} done A callback for completion
     * @return {Promise<Object>} A dictionary of variable names to values
     */
    this.getEnvironmentVariables = function (variableName, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;

        var vars = arguments.makeArray(),
            res  = {}, completed = 0;

        if(done === arguments.last()) vars.pop();

        return new Promise(function (resolve) {
            vars.each(function (v) {
                exec('xcrun simctl getenv ' + self.udid + ' ' + v, function (err, stdout) {
                    if(!err) res[v] = stdout.trim();

                    if(++completed === vars.length) {
                        resolve(res);
                        done.call(self, null, res);
                    }
                });
            });
        });
    };

    /**
     * @callback iOSSimulatorDevice~installCallback
     * @param {Error|Null} err An error, if one exists
     */

     /**
      * Installs an app file on a simulator device
      * @param {DeviceSession} session The DeviceSession associated with this device
      * @param {String} pathToApp The path to the app bundle
      * @param {iOSSimulatorDevice~installCallback=} done A callback for completion
      * @return {Promise<Error|Null>} An error if one occured
      */
    this.install = function (session, pathToApp, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof pathToApp === 'string') {
                exec('xcrun simctl install ' + self.udid + ' ' + pathToApp, function (err, stdout, stderr) {
                    if(err || stderr) {
                        e = new Error(err || new Error(stderr));
                        reject(e);
                        done.call(self, e);
                    }
                    else {
                        resolve(null);
                        done.call(self, null);
                    }
                });
            }
            else {
                e = new Error('iOSSimulatorDevice.uninstall expected argument #0 (bundleIdentifier) to be a string, but got: ' + typeof pathToApp);
                reject(e);
                done.call(self, e);
            }
        });
    };

    /**
     * @callback iOSSimulatorDevice~launchCallback
     * @param {Error|Null} err An error, if one exists
     */

    /**
     * Launches an installed app on the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {String} bundleIdentifier The bundle identifier of the app
     * @param {iOSSimulatorDevice~launchCallback=} done A callback for completion
     * @return {Promise<Error|Null>} An error if one occured
     */
    this.launch = function (session, bundleIdentifier, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof bundleIdentifier === 'string') {
                exec('xcrun simctl launch ' + self.udid + ' ' + bundleIdentifier, function (err, stdout, stderr) {
                    if(err || stderr) {
                        e = new Error(err || new Error(stderr));
                        reject(e);
                        done.call(self, e);
                    }
                    else {
                        resolve(null);
                        done.call(self, null);
                    }
                });
            }
            else {
                e = new Error('iOSSimulatorDevice.uninstall expected argument #0 (bundleIdentifier) to be a string, but got: ' + typeof bundleIdentifier);
                reject(e);
                done.call(self, e);
            }
        });
    };

    /**
     * @callback iOSSimulatorDevice~uninstallCallback
     * @param {Error|Null} err An error, if one exists
     */

     /**
      * Uninstalls an app on the device
      * @param {DeviceSession} session The DeviceSession associated with this device
      * @param {String} pathToApp The bundle identifier of the installed app
      * @param {iOSSimulatorDevice~uninstallCallback=} done A callback for completion
      * @return {Promise<Error|Null>} An error if one occured
      */
    this.uninstall = function (session, bundleIdentifier, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof bundleIdentifier === 'string') {
                exec('xcrun simctl uninstall ' + self.udid + ' ' + bundleIdentifier, function (err, stdout, stderr) {
                    if(err || stderr) {
                        e = new Error(err || new Error(stderr));
                        reject(e);
                        done.call(self, e);
                    }
                    else {
                        resolve(null);
                        done.call(self, null);
                    }
                });
            }
            else {
                e = new Error('iOSSimulatorDevice.uninstall expected argument #0 (bundleIdentifier) to be a string, but got: ' + typeof bundleIdentifier);
                reject(e);
                done.call(self, e);
            }
        });
    };

    /**
     * @callback iOSSimulatorDevice~eraseCallback
     * @param {Error|Null} err An error, if one exists
     */

     /**
      * Resets (erases) the device
      * @param  {iOSSimulatorDevice~eraseCallback=} done A callback for completion
      * @return {Promise<Error|Null>} An error if one occured
      */
    this.erase = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            exec('xcrun simctl erase ' + self.udid, function (err, stdout, stderr) {
                if(err || stderr) {
                    var e = new Error(err || new Error(stderr));
                    reject(e);
                    done.call(self, e);
                }
                else {
                    resolve(null);
                    done.call(self, null);
                }
            });
        });
    };

    /**
     * @callback iOSSimulatorDevice~waitForBootComplete
     * @param {Error|Null} err An error, if one exists
     * @param {Boolean} booted True if the device successfully reached the booted state, false otherwise
     */

     /**
      * Shuts down the device and closes the Simulator instance.
      * @param {iOSSimulatorDevice~waitForBootComplete=} done A callback invoked once the device has reached the booted state
      * or the number of attempts have been exhausted.
      * @return {Promise<Error|String>} An error, or the result of the 'xcrun simctl shutdown' execution
      */
    this.shutdown = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            self.stopAllInstruments(function () {
                exec('xcrun simctl shutdown ' + self.udid, function (err, stdout, stderr) {
                    if(err || stderr) {
                        reject(err || new Error(stderr));
                        done.call(err || new Error(stderr));
                    }
                    else {
                        if(simProcess) {
                            if(simProcess && !simProcess.killed) simProcess.kill('SIGINT');
                            resolve(stdout);
                            done.call(iOSDevice, stdout);
                        }
                        else {
                            exec('kill -2 ' + self.pid, function () {
                                resolve(stdout);
                                done.call(iOSDevice, stdout);
                            });
                        }
                    }
                });
            });
        });
    };

    /**
     * @callback iOSSimulatorDevice~bootComplete
     * @param {Error|Null} err An error, if one exists
     * @param {Boolean} booted True if the device successfully reached the booted state, false otherwise
     */

    /**
     * Starts the iOS Simulator
     * @param {iOSSimulatorDevice~bootComplete=} done A callback, invoked once the device has been booted
     * @return {Promise<Error|Null> An error, if one occured
     */
    this.boot = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var simPath;

        return new Promise(function (resolve, reject) {
            self.isBooted(function (err, booted) {
                if(booted !== true && !isBooting[self.udid]) {
                    isBooting[self.udid] = true;

                    // Retrieve the XCode path using 'xcode-select', as the user might be using a different version of XCode
                    iOSDevice.getXCodePath(function (err, xcodePath) {
                        if(err) {
                            reject(err);
                            done.call(self, err);
                        }
                        else {
                            simPath    = path.join(xcodePath, 'Applications', 'Simulator.app', 'Contents', 'MacOS', simulatorProcessName);
                            simProcess = spawn(simPath, ['-CurrentDeviceUDID', self.udid], { detached: true });
                            self.pid   = simProcess.pid;

                            // Ensure the device has been properly shutdown in simctl...
                            simProcess.on('exit', function () {
                                self.shutdown();
                            });

                            // Wait for the device to boot
                            waitForBoot(10, function (err) {
                                if(err) {
                                    reject(err);
                                    done.call(self, err);
                                }
                                else {

                                    self.getEnvironmentVariables('IPHONE_SIMULATOR_DEVICE', 'SIMULATOR_MAINSCREEN_HEIGHT', 'SIMULATOR_MAINSCREEN_WIDTH', 'SIMULATOR_MAINSCREEN_SCALE', function (err, res) {
                                        if(!err) {
                                            self.type    = res.IPHONE_SIMULATOR_DEVICE;
                                            self.height  = parseInt(res.SIMULATOR_MAINSCREEN_HEIGHT, 10);
                                            self.width   = parseInt(res.SIMULATOR_MAINSCREEN_WIDTH, 10);
                                            self.density = parseInt(res.SIMULATOR_MAINSCREEN_SCALE, 10);

                                            // JXA prefers that we at least focus the program initally, else it gets a bit wonky...
                                            exec("osascript -l AppleScript -e 'tell application \'System Events\'' -e 'set frontmost of the first process whose unix id is ' + self.pid + ' to true' -e 'end tell'", function () {
                                                isBooting[self.udid] = false;
                                                setTimeout(function () {
                                                    resolve(null);
                                                    done.call(self, null);
                                                }, iOSSimulatorDevice.POST_BOOT_DELAY);
                                            });
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
                // The device is already booted...
                else {
                    iOSSimulatorDevice.mapUDIDSToRunningSimulators(function (err, mapping) {
                        if(err) {
                            reject(err);
                            done.call(self, err);
                        }
                        else {
                            if(mapping[self.udid]) {
                                self.pid = mapping[self.udid];
                                exec("osascript -l AppleScript -e 'tell application \'System Events\'' -e 'set frontmost of the first process whose unix id is ' + self.pid + ' to true' -e 'end tell'", function () {
                                    isBooting[self.udid] = false;
                                    setTimeout(function () {
                                        resolve(null);
                                        done.call(self, null);
                                    }, 0);
                                });
                            }
                            else {
                                var e = isBooting[self.udid] ? iOSDevice.DEVICE_NOT_READY_ERROR : iOSDevice.DEVICE_ALREADY_BOOTED_ERROR;
                                reject(e);
                                done.call(self, e);
                            }
                        }
                    });
                }
            });
        });
    };

    /**
     * @callback iOSSimulatorDevice~simulatorDeviceStandardCallback
     * @param {Error|Null} err An error if one occured
     */

    /**
     * Restarts the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.restart = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = "Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Reboot').click();";
            executeJXACommand(command, function (err, stdout, stderr) {
                var e = err ? err : stderr ? new Error(stderr) : null;
                done.call(self, e);
                return err ? reject(e) : resolve(null);
            });
        });
    };

    /**
    * Rotates the device left, using the application menu
    * @param {DeviceSession} session The DeviceSession associated with this device
    * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
    * @return {Promise<Error|Null> An error if one occured
    */
    this.rotateLeft = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = "Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Rotate Left').click();";
            executeJXACommand(command, function (err) {
                if(!err) orientation--;
                if(orientation < 0) orientation = 3;
                done.call(self, err || null);
                return err ? reject(err) : resolve(null);
            });
        });
    };

    /**
     * Rotates the device right, using the application menu
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.rotateRight = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = "Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Rotate Right').click();";
            executeJXACommand(command, function (err) {
                if(!err) orientation++;
                if(orientation > 3) orientation = 0;
                done.call(self, err || null);
                return err ? reject(err) : resolve(null);
            });
        });
    };

    /**
     * Returns the device's orientation
     * @return {String} The device's orientation as a string description
     */
    this.getOrientation = function () {
        return iOSDevice.ORIENTATIONS[orientation];
    };

    /**
     * Locks the device screen, using the application menu
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.lockScreen = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = "Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Lock').click();";
            executeJXACommand(command, function (err) {
                done.call(self, err || null);
                return err ? reject(err) : resolve(null);
            });
        });
    };

    /**
     * Presses the device's home button, using the application menu
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.pressHomeKey = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = "Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Home').click();";
            executeJXACommand(command, function (err) {
                done.call(self, err || null);
                return err ? reject(err) : resolve(null);
            });
        });
    };

    /**
     * Performs the device's shake gesture, using the application menu
     * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.shakeScreen = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = "Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Shake').click();";
            executeJXACommand(command, function (err) {
                done.call(self, err || null);
                return err ? reject(err) : resolve(null);
            });
        });
    };

    /**
     * Sets the device's hardware keyboard status.
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {Boolean} connected If this evalutes to true, it will set the hardware keyboard to enabled, otherwise it will disabled it.
     * @param {iOSSimulatorDevice~simulatorDeviceStandardCallback=} done A callback for completion
     * @return {Promise<Error|Null> An error if one occured
     */
    this.setHardwareKeyboardConnected = function (session, connected) {
        var done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var command = connected ?
                "var menuItem = Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Keyboard').menus.byName('Keyboard').menuItems.byName('Connect Hardware Keyboard'); if (menuItem.attributes.byName('AXMenuItemMarkChar').value() === null) menuItem.click();":
                "var menuItem = Application('System Events').applicationProcesses.whose({ unixId: ' + self.pid + ' }).menuBars.at(0).menuBarItems.byName('Hardware').menus.byName('Hardware').menuItems.byName('Keyboard').menus.byName('Keyboard').menuItems.byName('Connect Hardware Keyboard'); if (menuItem.attributes.byName('AXMenuItemMarkChar').value() !== null) menuItem.click();";

            executeJXACommand(command, function (err) {
                done.call(self, err || null);
                return err ? reject(err) : resolve(null);
            });
        });
    };

};

/**
 * The time to delay before returning control after booting
 * @type {Number}
 */
iOSSimulatorDevice.POST_BOOT_DELAY = 3000;

/**
 * @callback iOSSimulatorDevice#createCallback
 * @param {Error} An error, if one occured
 * @param {iOSSimulatorDevice} The newly created simulator device
 */

/**
 * Create a new iOS Simulator
 * @param {Stiring} name The name of the new device
 * @param {Stiring} type The type of the new device (for example: iPhone 6, or iPhone 6s, or iPad Air)
 * @param {Stiring} runtime The sdk version of the device
 * @param {iOSSimulatorDevice#createCallback=} done A callback for completion
 * @return {Promise<Error|iOSSimulatorDevice> An error if one occured, or the new device.
 */
iOSSimulatorDevice.create = function (name, type, runtime, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        if(typeof name === 'string' && typeof type === 'string' && typeof runtime === 'string') {
            exec("xcrun simctl create '' + name + '' '' + type + '' '' + runtime + ''", function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    reject(e);
                    done.call(iOSSimulatorDevice, e, null);
                }
                else {
                    var times = 0;
                    iOSDevice.getDeviceByUDID(stdout.trim(), true, function checkForDevice (err, device) {
                        ++times;
                        if(err) {
                            reject(err);
                            done.call(iOSSimulatorDevice, err, null);
                        }
                        else if(!device && times < 3) {
                            iOSDevice.getDeviceByUDID(stdout.trim(), true, checkForDevice);
                        }
                        else {
                            resolve(device);
                            done.call(iOSSimulatorDevice, null, device);
                        }
                    });
                }
            }) ;
        }
        else {
            e = new Error('Invalid arguments types. iOSSimulatorDevice expects that all arguments (except the optional trailing callback) are strings.');
            reject(e);
            done.call(iOSSimulatorDevice, e, null);
        }
    });
};

/**
 * Maps device UDIDs with Simulator process ids by pgrep-ing Simulator and finding the UDID from the Simualtor
 * process launch arguments
 * @param  {Function} done A callback for completion
 * @return {Promise<Object>} An object containing UDID/PID key/value pairs
 */
iOSSimulatorDevice.mapUDIDSToRunningSimulators = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        exec('pgrep ^Simulator$', function (err, stdout, stderr) {
            if(err || stderr || !stdout) {
                e = err || new Error(stderr);
                reject(e);
                done.call(iOSSimulatorDevice, e, {});
            }
            else {
                var pids = stdout.trim().split('\n'), cmd = '';
                pids.each(function (pid) {
                    cmd += 'ps -o command= ' + pid + '; ';
                });

                exec(cmd, function (err, stdout, stderr) {
                    if(err || stderr || !stdout) {
                        resolve({});
                        done.call(iOSSimulatorDevice, e, {});
                    }
                    else {
                        var res = stdout.trim().split('\n'), mapping = {}, kill = [];
                        res.each(function (r, k, i) {
                            var m = r.match(/^.*-CurrentDeviceUDID ([a-zA-Z0-9\-]+)$/);
                            if(m instanceof Array && m[1] && m[1]) {
                                mapping[m[1]] = pids[i];
                            }
                            else {
                                kill.push(pids[i]);
                            }
                        });

                        if(kill.length === 0) {
                            resolve(mapping);
                            done.call(iOSSimulatorDevice, null, mapping);
                        }
                        else {
                            kill.each(function (pid) {
                                process.kill(pid, 'SIGINT');
                                resolve(stdout);
                                done.call(iOSDevice, stdout);
                            });
                        }
                    }
                });
            }
        });
    });
};

util.inherits(iOSSimulatorDevice, iOSDevice);
module.exports = iOSSimulatorDevice;
