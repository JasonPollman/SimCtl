/**
 * @namespace AndroidPhysicalDevice
 */
'use strict';

var util          = require('util'),
    AndroidDevice = require(__dirname);

/**
 * Android Physical Controller Class<br>
 * Spawns, boots, shutdowns, and manages an iOS Physical devices.
 * @constructor
 * @extends AndroidDevice
 */
var AndroidPhysicalDevice = function AndroidPhysicalDevice () {
    var self = this;
    AndroidDevice.apply(self, arguments);
};

util.inherits(AndroidPhysicalDevice, AndroidDevice);
module.exports = AndroidPhysicalDevice;
