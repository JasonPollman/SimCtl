/**
 * A device abstraction module, which controls, boots, and finds available devices.
 * @module Device
 */

'use strict';

var path    = require('path'),
    utils   = require('jpc-utils'),
    config  = require(path.join(__dirname, 'config.json')),
    Base    = require(path.join(__dirname, 'lib', 'BaseDevice')),
    debug   = new (require('jpc-debugger')).Client(__filename),
    drivers = {};

// Expose Device classes
module.exports = {
    iOS     : require(path.join(__dirname, 'lib', 'iOS')),
    Android : require(path.join(__dirname, 'lib', 'Android')),
};

// Load the drivers from the config file only...
config.drivers.each(function (driverPath) {
    var d = require(driverPath);

    if(Base.deviceTypeIsValid(d)) {
        drivers[driverPath] = d;
    }
    else {
        throw new Error(d.name ?
                'Device class ' + d.name + ' (' + path.resolve(driverPath) + ') is invalid and missing required methods and/or properties.' :
                'Device class at path ' + path.resolve(driverPath) + ' is invalid and missing required methods and/or properties.'
        );
    }
});

/**
 * @callback Device~discoverCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<iOSPhysicalDevice|iOSSimulatorDevice|AndroidSimulatorDevice|AndroidPhysicalDevice|BaseDevice>} A list of the available devices
 */

/**
 * Discover the available devices on this system
 * @param {Device~discoverCallback=} done A callback for completion
 * @param {Boolean=} onlyReturnAvailable Only show available devices
 * @return {Promise<Error|Array>} An array of available devices, or an error if one occured.
 */
exports.discover = function (onlyReturnAvailable, getListOnly, done) {
    debug.log('Discovering devices...');
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var deviceList = [], count = 0, total = drivers.members(), valid = [];

    if(typeof onlyReturnAvailable !== 'boolean') onlyReturnAvailable = true;
    if(typeof getListOnly         !== 'boolean') getListOnly         = false;

    return new Promise(function (resolve) {
        drivers.each(function (d) {
            d[onlyReturnAvailable ? 'getAvailableDevices' : 'getAllDevices'](function (err, devices) {
                if(!err && devices instanceof Array) deviceList = deviceList.concat(devices || []);
                if(++count === total) {
                    deviceList.each(function (d) {
                        var missing = Base.deviceIsValid(d);
                        if(missing.length === 0) valid.push(getListOnly ? d.toString() : d);
                    });
                    resolve(valid);
                    done.call(exports, null, valid);
                }
            });
        });
    });
};

/**
 * @callback Device~getDevicesWithNameCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<iOSPhysicalDevice|iOSSimulatorDevice|AndroidSimulatorDevice|AndroidPhysicalDevice|BaseDevice>} A list of the devices with the given name.
 */

/**
 * Gets all devices with the given name
 * @param {String} name The name of the device
 * @param  {Device~getDevicesWithNameCallback=} done A callback for completion
 * @return {Promise<Error|Array>} A list of the devices with the given name or an error if one occured.
 */
exports.getDevicesWithName = function (name, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var named = [];

    return new Promise(function (resolve, reject) {
        exports.discover(false)
            .then(function (devices) {
                devices.each(function (d) { if(d.name === name) named.push(d); });
                resolve(named);
                done.call(exports, null, named);
            })
            .catch(function (e) {
                reject(e);
                done.call(exports, e, []);
            });
    });
};

/**
 * @callback Device~getDevicesWithIdCallback
 * @param {Error|Null} error An error if on occured.
 * @param {Array<iOSPhysicalDevice|iOSSimulatorDevice|AndroidSimulatorDevice|AndroidPhysicalDevice|BaseDevice>} A list of the devices with the given id.
 */

/**
 * Gets the device with the given id
 * @param {String} name id id of the device
 * @param  {Function} done A callback for completion
 * @return {Promise<Error|Array>} A list of the devices with the given name or an error if one occured.
 */
exports.getDeviceWithId = function (id, done) {
    done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
    var device = null;

    return new Promise(function (resolve, reject) {
        exports.discover()
            .then(function (devices) {
                devices.each(function (d) {
                    if(d.id === id) {
                        device = d;
                        return false;
                    }
                });
                resolve(device);
                done.call(exports, null, device);
            })
            .catch(function (e) {
                reject(e);
                done.call(exports, e, device);
            });
    });
};
