/**
 * @namespace iOSDevice
 */
'use strict';

var exec   = require('child_process').exec,
    spawn  = require('child_process').spawn,
    util   = require('util'),
    utils  = require('jpc-utils'),
    path   = require('path'),
    Device = require(path.join(__dirname, '..', 'BaseDevice')),

    ChildProcess = require('child_process'),

    /**
     * A stored cache of devices by UDID
     * @type {Object<iOSSimulatorDevice|iOSPhysicalDevice>}
     * @memberof iOSDevice
     */
    DEVICE_CACHE = {},

    /**
     * A flag to indicate if we're currently walking 'instruments -s devices'. If true, subsequent calls to iOSDevice.generateDeviceObjects
     * will be invoked with the same results as the initial caller.
     * @type {Boolean}
     * @memberof iOSDevice
     */
    WALKING_DEVICES = false,

    /**
     * A flag to indicate if we're currently walking 'xcrun simctl list'. If true, subsequent calls to iOSDevice.getSimulatorDeviceStatuses
     * will be invoked with the same results as the initial caller.
     * @type {Boolean}
     * @memberof iOSDevice
     */
    WALKING_SIMS = false,

    /**
     * The last time 'instruments -s devices' was invoked
     * @type {Number}
     * @memberof iOSDevice
     */
    LAST_DEVICE_WALK = 0,

    /**
     * The last time 'xcrun simctl list' was invoked
     * @type {Number}
     * @memberof iOSDevice
     */
    LAST_SIM_WALK = 0,

    /**
     * A queue of callbacks to invoke if 'instruments -s devices' is called in a loop
     * @type {Array<Object>}
     * @memberof iOSDevice
     */
    DEVICE_QUEUE = [],

    /**
     * The amount of time to used caches objects, before making an execution call again.
     * @type {Number}
     * @memberof iOSDevice
     */
    REFRESH_TIMEOUT = 1000,


    /**
     * A stored cache of devices by Name
     * @type {Object<iOSSimulatorDevice|iOSPhysicalDevice>}
     * @memberof iOSDevice
     */
    DEVICE_CACHE_BY_NAME = {},

    /**
     * A stored object containing the results of 'xcrun simctl list'
     * @type {Object}
     * @memberof iOSDevice
     */
    SIM_DEVICE_CACHE = {},

    /**
     * A queue of callbacks to invoke if 'xcrun simctl list' is called in a loop
     * @type {Array<Object>}
     * @memberof iOSDevice
     */
    SIM_DEVICE_QUEUE = [],


    /**
     * A default runtime, if none is specified
     * @type {String}
     * @memberof iOSDevice
     */
    RUNTIME_LATEST = '9.2',

    /**
     * The regular expression that parses the results of 'instrument -s devices'
     * @type {RegExp}
     * @memberof iOSDevice
     */
    PARSE_AVAILABLE_DEVICES = /([a-zA-Z0-9!@#$%^&*()_+=\-\. ]+) \((\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\) \[([a-zA-Z-0-9\-]+)\]/gm,

    /**
     * The regular expression that parses the results of 'xcrun simctl list'
     * @type {RegExp}
     * @memberof iOSDevice
     */
    PARSE_SIMULATOR_DEVICES = /\s*([a-zA-Z0-9!@#$%^&*()_\- ]+) \(([a-zA-Z0-9\-]+)\) \((Shutdown|Booted)\)/gm,

    /**
     * After iOSDevice.getXCodePath is invoked once, the results will be stored here, and used in subsequent calls to
     * iOSDevice.getXCodePath.
     * @memberof iOSDevice
     * @type {String|null}
     */
    PATH_TO_SELECTED_XCODE  = null;

/**
 * A base iOS device class. Both iOSSimulatorDevice and iOSPhysicalDevice inherit from this class
 * @param {String} name The device's name
 * @param {String} runtime The device's sdk version
 * @param {String} udid The device's universal device identifier
 * @param {Boolean} isSimulator True if the device is a simulator, false if it's a physical device.
 * @constructor
 * @extends BaseDevice
 */
var iOSDevice = function iOSDevice (name, runtime, udid) {
    var self = this;

    /**
     * The device's OS
     * @type {String}
     */
    this.os = 'iOS';

    // Inherit from the base device class
    Device.apply(this, arguments);

    /**
     * The device's universal device identifier
     * @type {String}
     */
    this.udid = udid || null;

    /**
     * The device's sdk version
     * @type {String}
     */
    this.runtime = runtime || RUNTIME_LATEST;

    var instruments = {},
        instrumentsOptionsToFlags = {
            template  : '-t',
            document  : '-D',
            timeLimit : '-l',
            env       : '-e'
        };

    /**
     * Start an Insturments session on the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {Object} options Options to initialize instruments with
     * @param {String} options.template The name of the instruments template to start
     * @param {String=} options.app The path to the app to launch. Only applies to some instrument templates
     * @param {Number|String=} options.timeLimit The maximum amount of time to run the instrument
     * @param {Object<String>=} options.env An object containing key/value pairs of environment variables
     * @param  {Function=} done A callback for completion
     * @return {Promise<Error|ChildProcess>} The instruments process, or an error if one occured
     */
    this.startInstrument = function (session, options, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            var args         = [],
                envVariables = '',
                hrtime       = process.hrtime(),
                instrumentID = (hrtime[0] * 1e9 + hrtime[1]).toString(),
                instrument;

            options.each(function (o, k) {
                if(k === 'env' && typeof o === 'object') {
                    var v = '';
                    o.each(function (e, key) { v += '-e ' + key + ' ' + e + ' '; });
                    envVariables = v.trim();
                }
                else if(k !== 'template' && instrumentsOptionsToFlags[k] && typeof o === 'string') {
                    o = o.replace(/\[instrument-id]/g, instrumentID);
                    args.push(instrumentsOptionsToFlags[k]);
                    args.push(o);
                }
            });

            try {
                if(typeof options.template === 'string') args.push('-t');
                if(typeof options.template === 'string') args.push(options.template);

                // If simulator attach to the Simulator process instance
                if(self.simulator) args.push('-p', self.pid);

                // Push the device's UDID to this arguments
                args.push('-w', self.udid);

                // If specified, push the app target to the arguments
                if(typeof options.app === 'string') args.push(options.app);

                // Environment variables must be appended last
                args.push(envVariables);

                instruments[instrumentID] = spawn('instruments', args);
                instrument = { id: instrumentID, process: instruments[instrumentID], args: args };

                instruments[instrumentID].on('exit', function (code) {
                    if(instruments[instrumentID] && !instruments[instrumentID].scheduledClose) {
                        self.emit('testing sandbox terminated', code);
                    }
                });

                resolve(instrument);
                done.call(self, null, instrument);
            }
            catch (e) {
                reject(e);
                done.call(self, e, null);
            }
        });
    };

    /**
     * Stop the instrument with the given id
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {String} instrumentId The id of the instrument to stop
     * @param {Function} done A callback for completion. No arguments passed
     * @return {Promise}
     */
    this.stopInstrument = function (session, instrumentId, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            if(typeof instruments[instrumentId] === 'object' && instruments[instrumentId].process instanceof ChildProcess) {
                instruments[instrumentId].scheduledClose = true;
                instruments[instrumentId].process.kill('SIGINT');
                instruments[instrumentId].process = null;
                delete instruments[instrumentId];
            }
            resolve(null);
            done.call(self, null);
        });
    };

    /**
     * Stop all instruments running on the device
     * @param {DeviceSession} session The DeviceSession associated with this device
     * @param {Function} done A callback for completion. No arguments passed
     * @return {Promise}
     */
    this.stopAllInstruments = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var total = instruments.members(),
            count = 0;

        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            instruments.each(function (i) {
                self.stopInstrument(i.id, function () {
                    if(++count === total) {
                        resolve(null);
                        done.call(self, null);
                    }
                });
            });
        });
    };

    function onBootComplete (options, resolve, reject, done) {
        self.startInstrument({
            app      : options.app,
            document : path.join(self.localStorage, '[instrument-id].trace'),
            template : 'Automation',
            env      : {
                // UIASCRIPT      : 'index.js',
                UIARESULTSPATH : self.localStorage
            }

        }).then(function (instruments) {
            resolve(instruments);
            done.call(self, null, instruments);

        }).catch(function (e) {
            reject(e);
            done.call(self, e);
        });
    }

    /**
     * Prepares the app for automation testing.
     * @param  {String} options Options for testing preparation
     * @param  {Function} done A callback for completion. Only arugment passed is an optional error, if one occurs.
     * @return {Promise}
     */
    this.prepareForAutomationTesting = function (session, options, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.ifBootedAndAvailableDoWithSessionOrReject(session, done, function (resolve, reject, done) {
            self.isBooted(function (err, booted) {
                if(err) {
                    reject(err);
                    done.call(self, err, null);
                }
                else if (!booted) {
                    self.boot(function (err) {
                        if(err) {
                            reject(err);
                            done.call(self, err, null);
                        }
                        else {
                            onBootComplete(options, resolve, reject, done);
                        }
                    });
                }
                else {
                    self.stopAllInstruments(function () {
                        onBootComplete(options, resolve, reject, done);
                    });
                }
            });
        });
    };

    /**
     * Alias for iOSDevice.prepareForAutomationTesting
     * @alias iOSDevice~prepareForAutomationTesting
     * @type {Function}
     */
    this.startAutomationTesting = self.prepareForAutomationTesting;

    /**
     * Alias for iOSDevice.stopAllInstruments
     * @alias iOSDevice~stopAllInstruments
     * @type {Function}
     */
    this.stopAutomationTesting = self.stopAllInstruments;
};

Object.defineProperties(iOSDevice, {
    /**
     * Expose the iOSSimulatorDevice from this object.
     * @memberof iOSDevice
     * @type {iOSSimulatorDevice}
     */
    Simulator: {
        configurable : false,
        enumerable   : false,
        get          : function () {
            return require(__dirname, 'Simulator');
        }
    },

    /**
     * Expose the iOSPhysicalDevice from this object.
     * @memberof iOSDevice
     * @type {iOSSimulatorDevice}
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
 * The platform of the devices
 * @type {String}
 */
iOSDevice.PLATFORM = 'iOS';

/**
 * @callback iOSDevice~getSimulatorDeviceStatusesCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<Object>} simulators A list of simulators and their properties
 */

/**
 * Get's the status of each available simulator device
 * @param {Boolean=} refresh Force a refresh, and refuse the cached results.
 * @param {iOSDevice~getSimulatorDeviceStatusesCallback=} done A callback for completion
 * @return {Promise<Error|Array>} An array of simulator device statuses, or an error if one occured.
 */
iOSDevice.getSimulatorDeviceStatuses = function (refresh, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    if(typeof refresh !== 'boolean') refresh = false;
    var e;

    return new Promise(function (resolve, reject) {
        if(!WALKING_SIMS || (Date.now() - LAST_SIM_WALK > REFRESH_TIMEOUT)) {
            WALKING_SIMS  = true;
            LAST_SIM_WALK = Date.now();

            // Clear sim results cache
            SIM_DEVICE_CACHE = {};
            SIM_DEVICE_QUEUE.push({ resolve: resolve, reject: reject, done: done });

            exec('xcrun simctl list', function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);

                    SIM_DEVICE_QUEUE.each(function (o) {
                        o.reject(e);
                        o.done.call(iOSDevice, e, null);
                    });

                    SIM_DEVICE_QUEUE = [];
                    WALKING_SIMS     = false;
                }
                else {
                    var res;
                    while(res = PARSE_SIMULATOR_DEVICES.exec(stdout)) { // jshint ignore:line
                        if(!SIM_DEVICE_CACHE[res[2]]) {
                            SIM_DEVICE_CACHE[res[2]] = {
                                name   : res[1],
                                udid   : res[2],
                                status : res[3].toLowerCase() === 'booted' ? true : false
                            };
                        }
                        else {
                            SIM_DEVICE_CACHE[res[2]].name   = res[1];
                            SIM_DEVICE_CACHE[res[2]].udid   = res[2];
                            SIM_DEVICE_CACHE[res[2]].status = res[3].toLowerCase() === 'booted' ? true : false;
                        }
                    }

                    SIM_DEVICE_QUEUE.each(function (o) {
                        o.resolve(SIM_DEVICE_CACHE);
                        o.done.call(iOSDevice, null, SIM_DEVICE_CACHE);
                    });

                    SIM_DEVICE_QUEUE = [];
                    WALKING_SIMS     = false;
                }
            });
        }
        else {
            if(!WALKING_SIMS) {
                resolve(SIM_DEVICE_CACHE);
                done.call(iOSDevice, null, SIM_DEVICE_CACHE);
            }
            else {
                SIM_DEVICE_QUEUE.push({ resolve: resolve, reject: reject, done: done });
            }
        }
    });
};

/**
 * @callback iOSDevice~generateDeviceObjectsCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<Object>} simulators A list of simulators and their properties
 */

/**
 * Generates a list of available device objects
 * @param {Boolean=} refresh Force an exec call, and refuse cached results
 * @param {iOSDevice~generateDeviceObjectsCallback=} A callback for completion
 * @return {Promise<Error|Array>}
 */
iOSDevice.generateDeviceObjects = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        if(!WALKING_DEVICES || (Date.now() - LAST_DEVICE_WALK > REFRESH_TIMEOUT)) {
            WALKING_DEVICES  = true;
            LAST_DEVICE_WALK = Date.now();

            // Clear device cache
            DEVICE_CACHE         = {};
            DEVICE_CACHE_BY_NAME = [];
            DEVICE_QUEUE.push({ resolve: resolve, reject: reject, done: done });

            exec('instruments -s devices', function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    DEVICE_QUEUE.each(function (c) {
                        c.reject(e);
                        c.done.call(iOSDevice, e, null, null, null);
                    });
                    WALKING_DEVICES = false;
                    DEVICE_QUEUE    = [];
                }
                else {
                    var res, devices = [], complete = 0;
                    while(res = PARSE_AVAILABLE_DEVICES.exec(stdout)) devices.push(res); // jshint ignore:line

                    devices.each(function (d) {
                        iOSDevice.udidIsOfSimulator(d[3], function (err, isSimulator) {
                            if(err || stderr) {
                                e = err || new Error(stderr);

                                DEVICE_QUEUE.each(function (c) {
                                    c.reject(e);
                                    c.done.call(iOSDevice, e, null, null, null);
                                });
                                WALKING_DEVICES = false;
                                DEVICE_QUEUE    = [];
                            }
                            else {
                                var DeviceOfType = require(path.join(__dirname, isSimulator ? 'Simulator' : 'Physical'));
                                if(!DEVICE_CACHE[d[3]]) {
                                    DEVICE_CACHE[d[3]] = Device.DEVICES[d[3]] ? Device.DEVICES[d[3]] : new DeviceOfType(d[1], d[2], d[3], isSimulator);
                                }
                                else {
                                    DEVICE_CACHE[d[3]].name      = d[1];
                                    DEVICE_CACHE[d[3]].runtime   = d[2];
                                    DEVICE_CACHE[d[3]].simulator = isSimulator;
                                }

                                if(!DEVICE_CACHE_BY_NAME[d[1]]) DEVICE_CACHE_BY_NAME[d[1]] = [];
                                DEVICE_CACHE_BY_NAME[d[1]].push(DEVICE_CACHE[d[3]]);

                                DEVICE_CACHE[d[3]].getEnvironmentVariables('IPHONE_SIMULATOR_DEVICE', 'SIMULATOR_MAINSCREEN_HEIGHT', 'SIMULATOR_MAINSCREEN_WIDTH', 'SIMULATOR_MAINSCREEN_SCALE', function (err, res) {
                                    if(res.IPHONE_SIMULATOR_DEVICE)     DEVICE_CACHE[d[3]].type    = res.IPHONE_SIMULATOR_DEVICE;
                                    if(res.SIMULATOR_MAINSCREEN_HEIGHT) DEVICE_CACHE[d[3]].height  = parseInt(res.SIMULATOR_MAINSCREEN_HEIGHT, 10);
                                    if(res.SIMULATOR_MAINSCREEN_WIDTH)  DEVICE_CACHE[d[3]].width   = parseInt(res.SIMULATOR_MAINSCREEN_WIDTH, 10);
                                    if(res.SIMULATOR_MAINSCREEN_SCALE)  DEVICE_CACHE[d[3]].density = parseInt(res.SIMULATOR_MAINSCREEN_SCALE, 10);

                                    if(++complete === devices.length) {
                                        WALKING_DEVICES = false;
                                        var arr = DEVICE_CACHE.makeArray();
                                        DEVICE_QUEUE.each(function (c) {
                                            c.resolve(arr);
                                            c.done.call(iOSDevice, null, arr, DEVICE_CACHE, DEVICE_CACHE_BY_NAME);
                                        });
                                        DEVICE_QUEUE = [];
                                    }
                                });
                            }
                        });
                    });
                }
            });
        }
        else {
            if(!WALKING_DEVICES) {
                var arr = DEVICE_CACHE.makeArray();
                resolve(arr);
                done.call(iOSDevice, null, arr, DEVICE_CACHE, DEVICE_CACHE_BY_NAME);
            }
            else {
                DEVICE_QUEUE.push({ resolve: resolve, reject: reject, done: done });
            }
        }
    });
};

/**
 * Return the full list of iOS devices
 * @param {iOSDevice~generateDeviceObjectsCallback=} done A callback for completion
 * @return Promise<Error|Array> An array of iOSSimulatorDevices and iOSPhysicalDevices or an error if one occured.
 */
iOSDevice.getAllDevices = function () {
    return iOSDevice.generateDeviceObjects.apply(iOSDevice, arguments);
};

/**
 * Return the list available of iOS devices
 * @param {iOSDevice~generateDeviceObjectsCallback=} done A callback for completion
 * @return Promise<Error|Array> An array of iOSSimulatorDevices and iOSPhysicalDevices or an error if one occured.
 */
iOSDevice.getAvailableDevices = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;

    return new Promise(function (resolve, reject) {
        iOSDevice.generateDeviceObjects(function (err, devices) {
            if(err) {
                reject(err);
                done.call(iOSDevice, err, []);
            }
            else {
                var count = 0, total = devices.length, available = [];
                devices.each(function (d) {
                    d.isAvailable(function (a) {
                        if(a) available.push(d);
                        if(++count === total) {
                            resolve(available);
                            done.call(iOSDevice, null, available);
                        }
                    });
                });
            }
        });
    });
};

/**
 * @callback iOSDevice~getDeviceByUDIDCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<Object>} devices A list of devices and their properties
 */

/**
 * Get a device using a udid
 * @alias iOSDevice.getDeviceWithId
 * @param {String} udid The device identifier
 * @param {iOSDevice~getDeviceByUDIDCallback=} done A callback for completion
 * @return {Promise<Error|iOSSimulatorDevice|iOSPhysicalDevice>}
 */
iOSDevice.getDeviceByUDID = function (udid, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        if(typeof udid === 'string') {
            iOSDevice.generateDeviceObjects(function (err, deviceArr, devicesByUDID) {
                if(err) {
                    reject(err);
                    done.call(iOSDevice, err, null);
                }
                else {
                    resolve(devicesByUDID[udid] || null);
                    done.call(iOSDevice, null, devicesByUDID[udid] || null);
                }
            });
        }
        else {
            e = new Error('Invalid argument. iOSDevice.getDeviceByUDID expected argument #0 to be a string, but got: ' + typeof udid);
            reject(e);
            done.call(iOSDevice, e, null);
        }
    });
};

/**
 * @callback iOSDevice~getXCodePathCallback
 * @param {Error|Null} error An error if on occured.
 * @param {String} xCodePath The path to the active XCode version
 */

/**
 * Get the path to the active XCode version. On the first run this method makes a call to 'xcode-select -p'. Once the
 * results are retrieved successfully, PATH_TO_SELECTED_XCODE is returned on successuve calls.
 * @param  {iOSDevice~getXCodePathCallback=} done A callback for completion
 * @return {Promise<Error|String>} The path to the selected verison of XCode, or an error if one occured.
 */
iOSDevice.getXCodePath = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var e;

    return new Promise(function (resolve, reject) {
        if(!PATH_TO_SELECTED_XCODE) {
            exec('xcode-select -p', function (err, stdout, stderr) {
                if(err || stderr) {
                    e = err || new Error(stderr);
                    reject(e);
                    done.call(iOSDevice, e, []);
                }
                else {
                    PATH_TO_SELECTED_XCODE = stdout.trim();
                    resolve(PATH_TO_SELECTED_XCODE);
                    done.call(iOSDevice, null, PATH_TO_SELECTED_XCODE);
                }
            });
        }
        else {
            resolve(PATH_TO_SELECTED_XCODE);
            done.call(iOSDevice, null, PATH_TO_SELECTED_XCODE);
        }
    });
};


/**
 * @callback iOSDevice~getBootedDevicesCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<iOSSimulatorDevices|iOSPhysicalDevices>} bootediOSDevices An array of booted devices
 */

/**
 * Gets all booted devices
 * @param {iOSDevice~getBootedDevicesCallback=} done A callback for completion
 * @return {Promise<Error|Array> An error if one occured, or an array of iOSDevices
 */
iOSDevice.getBootedDevices = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        iOSDevice.generateDeviceObjects(function (err, devices) {
            if(err) {
                reject(err);
                done.call(iOSDevice, err, []);
            }
            else {
                var booted = [];
                devices.each(function (d) {
                    d.isBooted(function (err, isBooted) {
                        if(isBooted) booted.push(d);

                        if(d === devices.last()) {
                            resolve(booted);
                            done.call(iOSDevice, null, booted);
                        }
                    });
                });
            }
        });
    });
};

/**
 * @callback iOSDevice~getDevicesWithNameCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<iOSSimulatorDevice|iOSPhysicalDevice>} devices A list of the devices with the given name
 */

/**
 * Get a device using a the device name
 * @param {String} name The name of the device
 * @param {Boolean=} refresh Force a refresh and ignore cached results
 * @param {iOSDevice~getDevicesWithNameCallback=} done A callback for completion
 * @return {Promise<Error|Array>}
 */
iOSDevice.getDevicesWithName = function (name, refresh, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        if(typeof name !== 'string') {
            var e = new Error('iOSDevice.getDevicesWithName expected argument #0 (name) to be a string, but got: ' + typeof name);
            reject(e);
            done.call(iOSDevice, e, []);
        }
        else {
            iOSDevice.getAvailableDevices(!!refresh, function (err, devices, devicesByUDID, devicesByName) {
                if(err) {
                    reject(err);
                    done.call(iOSDevice, err, []);
                }
                else {
                    resolve(devicesByName[name] || null);
                    done.call(iOSDevice, null, devicesByName[name] || null);
                }
            });
        }
    });
};

/**
 * Alias for iOSDevice.getDeviceByUDID
 * @see iOSDevice.getDeviceByUDID
 * @type {Function}
 */
iOSDevice.getDeviceWithId = iOSDevice.getDeviceByUDID;

/**
 * @callback iOSDevice~getBootedSimulatorDevicesCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<iOSSimulatorDevices|iOSPhysicalDevices>} devices An array of booted devices
 */

/**
 * Gets all booted simulator devices
 * @param {iOSDevice~getBootedSimulatorDevicesCallback=} done A callback for completion
 * @return {Promise<Error|Array> An error if one occured, or an array of iOSSimulatorDevices
 */
iOSDevice.getBootedSimulatorDevices = function (done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        iOSDevice.getBootedDevices(function (err, devices) {
            if(err) {
                reject(err);
                done.call(iOSDevice, err, []);
            }
            else {
                var sims = [];
                devices.each(function (d) {
                    if(d.simulator) sims.push(d);
                    if(d === devices.last()) {
                        resolve(sims);
                        done.call(iOSDevice, null, sims);
                    }
                });
            }
        });
    });
};

/**
 * @callback iOSDevice~udidIsOfSimulatorCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Boolean} deviceWithUDIDisASimulator True if the provided udid belongs to a simulator, false otherwise.
 */

/**
 * Determines if the provided UDID is from a simulator or a physical device.
 * @param {String} udid The udid to determine a simulator relationship for
 * @param {Boolean=} refresh Force a refresh, and ignore cached results
 * @param {iOSDevice~udidIsOfSimulatorCallback=} done A callback for completion
 * @return {Promise<Error|Boolean>} True if the provided udid belongs to a simulator, false otherwise.
 */
iOSDevice.udidIsOfSimulator = function (udid, refresh, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    return new Promise(function (resolve, reject) {
        iOSDevice.getSimulatorDeviceStatuses(refresh, function (err, simulators) {
            if(err) {
                reject(err);
                done.call(iOSDevice, err, false);
            }
            else {
                var isOfSimulator = !!simulators[udid];
                resolve(isOfSimulator);
                done.call(iOSDevice, null, isOfSimulator);
            }
        });
    });
};

util.inherits(iOSDevice, Device);
module.exports = iOSDevice;
