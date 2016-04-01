'use strict';


var path     = require('path'),
    config   = require(path.join(__dirname, '..', 'config.json')),
    utils    = require('jpc-utils'),
    sessions = {};

var DeviceSession = function () {
    var self     = this,
        time     = process.hrtime(),
        token    = ((time[0] * 1e9) + time[1]).toString().md5,
        lastUsed = Date.now(),
        timeout  = typeof config === 'object' && !isNaN(parseInt(config.deviceSessionTimeout, 10)) ? parseInt(config.deviceSessionTimeout, 10) : 1000 * 60 * 5; // Default 5 Minutes

    /**
     * Validates that the session has not expired and updates the session's last use time
     * @param  {Function} done A callback for completion
     * @return {Boolean} True if the session is valid, false otherwise
     */
    this.validate = function (done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        var isValid = (Date.now() - lastUsed < timeout) && token && sessions[token];

        if(isValid) lastUsed = Date.now(); else self.destroy();
        done.call(self, isValid);
        return isValid;
    };

    /**
     * Compares antoher session to this one
     * @param  {DeviceSession} session The DeviceSession object to compare this one to.
     * @return {Boolean} True if the comparison passed, false otherwise
     */
    this.compare = function (session) {
        return session === this;
    };

    /**
     * Compares antoher session to this one and validates that the session is valid
     * @param  {DeviceSession} session The DeviceSession object to compare this one to.
     * @param  {Function} done A callback for completion
     * @return {Boolean} If the comparison passed and the validation of the current session passed
     */
    this.compareAndValidate = function (session, done) {
        done = arguments.last() instanceof Function ? arguments.last() : utils.NULLF;
        return self.compare(session) && self.validate(done);
    };

    /**
     * Destroys the session, making it invalid
     * @return {DeviceSession} The current DeviceSession object
     */
    this.destroy = function () {
        token = null;
        sessions[token] = null;
        delete sessions[token];
        return self;
    };

    /**
     * Returns the token associated with this DeviceSession
     * @return {String} The token associated with this DeviceSession
     */
    this.getToken = function () {
        return token;
    };

    // Push session to session store
    sessions[token] = self;
};

/**
 * A generic error for when an invalid token is passed to a method that requires a token
 * @type {Error}
 */
DeviceSession.INVALID_SESSION = new Error('Invalid session.');

/**
 * Get a session by token value
 * @param  {String} token The token to use to get the device session
 * @return {DeviceSession|Null} The DeviceSession associated with the token, or null if no such DeviceSession exists...
 */
DeviceSession.getSessionByToken = function (token) {
    return sessions[token] || null;
};

module.exports = DeviceSession;
