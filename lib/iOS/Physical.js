/**
 * @namespace PhysicalDevice
 */
"use strict";

var util      = require('util'),
    iOSDevice = require(__dirname);

/**
 * A iOS Physical Controller Class<br>
 * Spawns, boots, shutdowns, and manages an iOS Physical devices.
 * @constructor
 * @extends iOSDevice
 */
var iOSPhysicalDevice = function iOSPhysicalDevice () {
    var self = this;
    iOSDevice.apply(self, arguments);
};

util.inherits(iOSPhysicalDevice, iOSDevice);
module.exports = iOSPhysicalDevice;
