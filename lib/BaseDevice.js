/**
 * @namespace BaseDevice
 */
'use strict';
var path  = require('path'),
    util  = require('util'),
    utils = require('jpc-utils'),
    fs    = require('node-fs-extra'),
    debug = new (require('jpc-debugger')).Client(__filename),

    DeviceSession = require(path.join(__dirname, 'DeviceSession')),
    EventEmitter  = require('events').EventEmitter;

/**
 * A generic device class. All devices must inherit from this class!
 * @constructor
 * @extends EventEmitter
 */
var BaseDevice = function (name, sdk, id, isSimulator, type) {
    BaseDevice.DEVICES[id] = this;
    debug.log('New BaseDevice created with name: ' + name);

    var self      = this,
        localLock = false,
        session   = null;

    EventEmitter.call(self);

    /**
     * The name of the device
     * @type {String}
     */
    this.name = name || null;

    /**
     * The device's universal device identifier
     * @type {String}
     */
    this.id = id || null;

    /**
     * The device's sdk version
     * @type {String}
     */
    this.sdk = sdk || null;

    /**
     * True if the device is a simulator, false otherwise
     * @type {Boolean}
     */
    this.simulator = isSimulator || null;

    /**
     * The device's platform (or type... i.e. iPad, iPhone, iWatch, Apple TV etc.)
     * @type {String}
     */
    this.type = type || 'Unknown';

    /**
     * The screen's pixel density
     * @type {Number}
     */
    this.density = 'Unknown';

    /**
     * The screen width in pixles
     * @type {Number}
     */
    this.width = 'Unknown';

    /**
     * The screen height in pixles
     * @type {Number}
     */
    this.height = 'Unknown';

    /**
     * The directory for storing temporary values for this specific device
     * @type {Number}
     */
    this.localStorage = path.join(utils.USER_HOME, '.DeviceStorage', self.id.md5);

    /**
     * The directory for storing temporary values for this specific device
     * @type {Number}
     */
    this.tempStorage = path.join(utils.USER_HOME, '.DeviceStorage', self.id.md5, 'temp');

    // Create the device's local storage directory
    fs.mkdirs(self.tempStorage, utils.NULLF);

    /**
     * A string representation of the device
     * @return {String}
     */
    this.toString = function () {
        return (self.constructor.name.pad(22, ' ') + ': ' + self.name).pad(63, '.', true).ellipses(80) + ' [OS:' + self.os + ', Id:' + self.id + ', Model:' + self.type + ', SDK: ' + self.sdk + ']';
    };

    /**
     * @callback BaseDevice~readLockCallback
     * @param {Object} lock An object with information about the device's lock status
     * @param {Error|Null} err An error, if one was returned by the exec call.
     */

    /**
     * Reads the lock file and resolves a lock status
     * @param  {BaseDevice~readLockCallback=} done A callback for completion
     * @return {Promise<Error|Object>} An error if one occured, or the device's lock status
     */
    function readLock (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var status;

        return new Promise(function (resolve, reject) {
            if(localLock === true) {
                status = { locked: 1, pid: process.pid };
                resolve(status);
                done.call(self, null, status);
            }
            else {
                fs.readFile(path.join(self.localStorage, '.lock'), function (err, contents) {
                    if(err && err.code !== 'ENOENT') {
                        reject(err);
                        done.call(self, err, null);
                    }
                    else if(err && err.code === 'ENOENT') {
                        contents = '0.' + process.pid.toString();
                        fs.writeFile(path.join(self.localStorage, '.lock'), contents, function (err) {
                            if(err) {
                                reject(err);
                                done.call(self, err);
                            }
                            else {
                                status = { locked : false, pid: process.pid };
                                resolve(status);
                                done.call(self, err, status);
                            }
                        });
                    }
                    else {
                        contents = contents.toString('utf-8').trim().split('.');
                        status = { locked: parseInt(contents[0], 10) === 0 ? false : true, pid: parseInt(contents[1], 10) };

                        if(status.locked && status.pid !== process.pid) {
                            utils.getProcessPathByPID(status.pid, function (processPath) {
                                if(err) {
                                    reject(err);
                                    done.call(self, err);
                                }
                                else if(!processPath) {
                                    status = { locked: false, pid: process.pid };
                                    fs.writeFile(path.join(self.localStorage, '.lock'), '0.' + process.pid.toString(), function (err) {
                                        if(err) {
                                            reject(err);
                                            done.call(self, err);
                                        }
                                        else {
                                            resolve(status);
                                            done.call(self, null, status);
                                        }
                                    });
                                }
                                else {
                                    resolve(status);
                                    done.call(self, null, status);
                                }
                            });
                        }
                        else {
                            resolve(status);
                            done.call(self, null, status);
                        }
                    }
                });
            }
        });
    }

    /**
     * @callback BaseDevice~writeLockCallback
     * @param {Error|Null} err An error, if one was returned by the exec call.
     */

    /**
     * Reads the lock file and resolves a lock status
     * @param  {BaseDevice~writeLockCallback=} done A callback for completion
     * @return {Promise<Error|Object>} An error if one occured, or the device's lock status
     */
    function writeLock (locked, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            readLock(function (err, status) {
                if(err) {
                    resolve(err);
                    done.call(self, err);
                }
                else {
                    if(status.locked && status.pid !== process.pid) {
                        var e = new Error('Device is locked by another process, unable to write to lock file.');
                        resolve(e);
                        done.call(self, e);
                    }
                    else {
                        locked = !!locked;
                        var contents = (locked === true ? '1' : '0') + '.' + process.pid.toString();

                        localLock = locked ? true : false;
                        fs.writeFile(path.join(self.localStorage, '.lock'), contents, function (err) {
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
                }
            });
        });
    }

    /**
     * Sets the device lock
     * @param  {Function=} done A callback for completion, with only a possible error passed as an argument.
     * @return {Promise<Error>} An error, if one occured
     */
    function lock (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            writeLock(true, function (err) {
                if(err) {
                    reject(err);
                    done.call(self, err);
                }
                else {
                    debug.log('Device with name ' + self.name + ' has been locked');
                    resolve();
                    done.call(self, null);
                }
            });
        });
    }

    /**
     * Unlocks the device lock
     * @param  {Function=} done A callback for completion, with only a possible error passed as an argument.
     * @return {Promise<Error>} An error, if one occured
     */
    function unlock (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            writeLock(false, function (err) {
                if(err) {
                    reject(err);
                    done.call(self, err);
                }
                else {
                    debug.log('Device with name ' + self.name + ' has been unlocked');
                    resolve();
                    done.call(self, null);
                }
            });
        });
    }

    /**
     * @callback BaseDevice~purgeLocalStorageCallback
     * @param {Error|Null} err An error, if one was returned by the exec call.
     */

    /**
     * Purges the device's local storage
     * @param {BaseDevice~purgeLocalStorageCallback=} done A callback for completion
     * @return {Promise<Error|Null>} An error, if one occured.
     */
    this.purgeLocalStorage = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return new Promise(function (resolve, reject) {
            self.isBooted(function (err, booted) {
                if(err) {
                    reject(e);
                    done.call(self, e);
                }
                else if(booted) {
                    reject(BaseDevice.DEVICE_BOOTED_ERROR);
                    done.call(self, BaseDevice.DEVICE_BOOTED_ERROR);
                }
                else {
                    self.isLocked(function (locked) {
                        if(locked) {
                            reject(BaseDevice.DEVICE_IS_LOCKED_ERROR);
                            done.call(self, BaseDevice.DEVICE_IS_LOCKED_ERROR);
                        }
                        else {
                            fs.remove(self.localStorage, function (err) {
                                if(err) {
                                    reject(err);
                                    done.call(self, err);
                                }
                                else {
                                    fs.mkdirs(self.tempStorage, function (err) {
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
                }
            });
        });
    };

    /**
     * @callback BaseDevice~purgeTempStorageCallback
     * @param {Error|Null} err An error, if one was returned by the exec call.
     */

    /**
     * Purges the device's local storage
     * @param {BaseDevice~purgeLocalStorageCallback=} done A callback for completion
     * @return {Promise<Error|Null>} An error, if one occured.
     */
    this.purgeTempStorage = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var e;

        return new Promise(function (resolve, reject) {
            self.isBooted(function (err, booted) {
                if(err) {
                    reject(e);
                    done.call(self, e);
                }
                else if(booted) {
                    reject(BaseDevice.DEVICE_BOOTED_ERROR);
                    done.call(self, BaseDevice.DEVICE_BOOTED_ERROR);
                }
                else {
                    self.isLocked(function (locked) {
                        if(locked) {
                            reject(BaseDevice.DEVICE_IS_LOCKED_ERROR);
                            done.call(self, BaseDevice.DEVICE_IS_LOCKED_ERROR);
                        }
                        else {
                            fs.remove(self.tempStorage, function (err) {
                                if(err) {
                                    reject(err);
                                    done.call(self, err);
                                }
                                else {
                                    fs.mkdirs(self.tempStorage, function (err) {
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
                }
            });
        });
    };

    /**
     * @callback BaseDevice~startSessionCallback
     * @param {DeviceSession} session A DeviceSession object
     * @param {Error|Null} err An error, if one was returned by the exec call.
     */

    /**
     * Starts a session on the device, which locks it (using a lock file) and marks it as unavailable
     * @param {BaseDevice~startSessionCallback=} done A callback for completion
     * @return {Promise<Error|Null>} An error, if one occured.
     */
    this.startSession = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            self.isLocked(function (locked) {
                if(locked) {
                    reject(BaseDevice.DEVICE_IS_LOCKED_ERROR);
                    done.call(self, BaseDevice.DEVICE_IS_LOCKED_ERROR, null);
                }
                else {
                    if(!(session instanceof DeviceSession)) {
                        session = new DeviceSession();
                        lock(function (err) {
                            if(err) {
                                reject(err);
                                done.call(self, err, null);
                            }
                            else {
                                if(self.rotateTo instanceof Function) {
                                    self.rotateTo(session, 0, function () {
                                        resolve(session);
                                        done.call(self, null, session);
                                    });
                                }
                                else {
                                    resolve(session);
                                    done.call(self, null, session);
                                }
                            }
                        });
                    }
                    else {
                        var e = new Error('Unable to start session, because another session is already started.');
                        reject(e);
                        done.call(self, e, null);
                    }
                }
            });
        });
    };

    /**
     * @callback BaseDevice~stopSessionCallback
     * @param {DeviceSession} session A DeviceSession instance
     * @param {Error|Null} err An error, if one was returned by the exec call.
     */

    /**
     * Stops a device session and unlocks the device, marking it as available.
     * @param {BaseDevice~stopSessionCallback=} done A callback for completion
     * @return {Promise<Error|Null>} An error, if one occured.
     */
    this.endSession = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve, reject) {
            if(session instanceof DeviceSession && session.validate()) {
                unlock(function (err) {
                    if(err) {
                        reject(err);
                        done.call(self, err, null);
                    }
                    else {
                        session.destroy();
                        session = null;
                        resolve();
                        done.call(self, null);
                    }
                });
            }
            else if(session instanceof DeviceSession && !session.validate()) {
                session.destroy();
                unlock(function () {
                    session = null;
                    resolve();
                    done.call(self, null);
                });
            }
            else {
                reject(session);
                done.call(self, DeviceSession.INVALID_SESSION, null);
            }
        });
    };

    /**
     * Perform the callback 'action' if the device is booted, unlocked, and the user has a valid session... otherwise a failure is passed on.
     * @param  {Function} done The callback to be invoked if the device is booted, after the action has been completed.
     * @param  {Function} action The action to be invoked if the device is booted
     * @return {Promise<Error|*>} A promise, whos resolution methods will be passed to the action callback.
     */
    this.ifBootedAndAvailableDoWithSessionOrReject = function (userSession, done, action) {
        return new Promise(function (resolve, reject) {
            if(!(userSession instanceof DeviceSession) || !(session instanceof DeviceSession)) {
                reject(DeviceSession.INVALID_SESSION);
                done.call(self, DeviceSession.INVALID_SESSION, null);
            }
            else {
                session.compareAndValidate(userSession, function (isValid) {
                    if(!isValid) {
                        reject(DeviceSession.INVALID_SESSION);
                        done.call(self, DeviceSession.INVALID_SESSION, null);
                    }
                    else {
                        readLock(function (err, lock) {
                            if(err) {
                                reject(err);
                                done.call(self, err, null);
                            }
                            else if(!lock.locked || lock.pid === process.pid) {
                                self.isBooted(function (err, booted) {
                                    if(err) {
                                        reject(err);
                                        done.call(self, err);
                                    }
                                    else if(!booted) {
                                        var e = BaseDevice.DEVICE_NOT_BOOTED_ERROR;
                                        reject(e);
                                        done.call(self, e);
                                    }
                                    else {
                                        action(resolve, reject, done);
                                    }
                                });
                            }
                            else {
                                reject(BaseDevice.DEVICE_IS_LOCKED_ERROR);
                                done.call(self, BaseDevice.DEVICE_IS_LOCKED_ERROR, null);
                            }
                        });
                    }
                });
            }
        });
    };

    /**
     * True if the device is locked, false otherwise.
     * @param  {Function=} done A callback for completion, with only a boolean (isLocked) passed as an argument.
     * @return {Promise<Boolean>} True if the device is locked, false otherwise
     */
    this.isLocked = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve) {
            readLock(function (err, lock) {
                if(typeof lock === 'object' && lock.locked) {
                    resolve(true);
                    done.call(self, true);
                }
                else {
                    resolve(false);
                    done.call(self, false);
                }
            });
        });
    };

    /**
     * True if the device is unlocked and no session is started on it, false otherwise
     * @param  {Function=} done A callback for completion, with only a boolean (locked) passed as an argument.
     * @return {Promise<Boolean>} True if the device is available, false otherwise
     */
    this.isAvailable = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return new Promise(function (resolve) {
            if(session.started === true) {
                resolve(false);
                done.call(self, false);
            }
            else {
                self.isLocked(function (locked) {
                    if(locked) {
                        resolve(false);
                        done.call(self, false);
                    }
                    else {
                        resolve(true);
                        done.call(self, true);
                    }
                });
            }
        });
    };

    /**
     * Boots the device
     * @type {Function|Error}
     */
    this.boot = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Starts UI Automation testing on the BaseDevice...
     * @type {Function|Error}
     */
    this.startAutomationTesting = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Stops UI Automation testing on the BaseDevice...
     * @type {Function|Error}
     */
    this.stopAutomationTesting = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Shutsdown the device and cleans up any extraneous running processes
     * @type {Function|Error}
     */
    this.shutdown = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Installs an app on the device
     * @type {Function|Error}
     */
    this.install = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Uninstalls an app from the device
     * @type {Function|Error}
     */
    this.uninstall = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Gets the device's current orientation
     * @type {Function|Error}
     */
    this.getOrientation = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;

    /**
     * Determines if the device is booted or note
     * @type {Function|Error}
     */
    this.isBooted = BaseDevice.UNIMPLEMENTED_DEVICE_METHOD;
};

/**
 * Used to recycle device objects rather than creating new ones...
 * @type {Object<BaseDevice>}
 */
BaseDevice.DEVICES = {};

/**
 * A generic error for a device that's missing a method
 * @type {Error}
 */
BaseDevice.DEVICE_IS_LOCKED_ERROR = new Error('Device is locked.');

/**
 * A generic error for a device that's missing a method
 * @type {Error}
 */
BaseDevice.UNIMPLEMENTED_DEVICE_METHOD = new Error('Device is missing a required method.');


/**
 * A generic error for when a device isn't booted.
 * @type {Error}
 */
BaseDevice.DEVICE_NOT_BOOTED_ERROR = new Error('Device not booted.');

/**
 * A generic error for when a device hasn't finished booted, but has started.
 * @type {Error}
 */
BaseDevice.DEVICE_NOT_READY_ERROR = new Error('Device is not yet finished booting...');

/**
 * A generic error for when a device is already booted
 * @type {Error}
 */
BaseDevice.DEVICE_ALREADY_BOOTED_ERROR = new Error('Device is already booted.');

/**
 * The available orientations for a device
 * @type {Array<String>}
 */
BaseDevice.ORIENTATIONS = ['portrait', 'landscape right', 'portrait upsidedown', 'landscape right'];

/**
 * A list of required methods each device must implement
 * @type {Array<String>}
 */
BaseDevice.REQUIRED_METHODS = [
    'boot',
    'shutdown',
    'install',
    'uninstall',
    'getOrientation',
    'isBooted',
    'isAvailable',
    'isLocked',
    'purgeLocalStorage',
    'purgeTempStorage',
    'startSession',
    'endSession'
];

/**
 * A list of required static methods each device class must implement
 * @type {Array<String>}
 */
BaseDevice.REQUIRED_STATIC_METHODS = [
    'getAllDevices',
    'getAvailableDevices',
    'getDevicesWithName',
    'getDeviceWithId',
];

/**
 * A list of required  properties each device class must have
 * @type {Array<String>}
 */
BaseDevice.REQUIRED_PROPERTIES = [
    { type: 'string'        , name: 'os'           },
    { type: 'string'        , name: 'name'         },
    { type: 'string'        , name: 'id'           },
    { type: 'string'        , name: 'sdk'          },
    { type: 'string'        , name: 'type'         },
    { type: 'boolean'       , name: 'simulator'    },
    { type: 'number|string' , name: 'density'      },
    { type: 'number|string' , name: 'width'        },
    { type: 'number|string' , name: 'height'       },
    { type: 'string'        , name: 'localStorage' }
];

/**
 * A list of required static properties each device class must have
 * @type {Array<String>}
 */
BaseDevice.REQUIRED_STATIC_PROPERTIES = [
    { type: 'string' , name: 'PLATFORM' }
];

/**
 * Asserts that a device contains all the required methods and properties
 * @param {Device} device The device to inspect
 * @return {Boolean} True if the device implements all of its methods
 */
BaseDevice.deviceIsValid = function (device) {
    if(!(device instanceof BaseDevice)) return false;
    var missing = [];

    BaseDevice.REQUIRED_METHODS.each(function (m) {
        if(!device[m] || !(device[m] instanceof Function) || device[m] === BaseDevice.UNIMPLEMENTED_DEVICE_METHOD) {
            missing.push('Method: ' + m);
        }
    });

    BaseDevice.REQUIRED_PROPERTIES.each(function (p) {
        if(device[p.name] === undefined || p.type.split('|').indexOf(typeof device[p.name]) === -1) {
            missing.push('Property: ' + p.name);
        }
    });
    return missing;
};

/**
 * Asserts that a device class has all the required static properties
 * @param {Device} device The device to inspect
 * @return {Boolean} True if the device implements all of its methods
 */
BaseDevice.deviceTypeIsValid = function (deviceClass) {
    if(!(deviceClass instanceof Function)) return false;
    var missing = [];

    BaseDevice.REQUIRED_STATIC_METHODS.each(function (m) {
        if(!deviceClass[m] || !(deviceClass[m] instanceof Function)) {
            missing.push('Method: ' + m);
        }
    });

    BaseDevice.REQUIRED_STATIC_PROPERTIES.each(function (p) {
        if(deviceClass[p.name] === undefined || p.type.split('|').indexOf(typeof deviceClass[p.name]) === -1) {
            missing.push('Property: ' + p.name);
        }
    });
    return missing;
};

util.inherits(BaseDevice, EventEmitter);
module.exports = BaseDevice;
