/////////////////////////////////////////////////////////////////////////////////////////////
//
// using.js
// v2.3.0
//
//    A cross-platform, expandable module loader for javascript.
//
// License
//    Apache License Version 2.0
//
// Copyright Nick Verlinden (info@createconform.com)
//
/////////////////////////////////////////////////////////////////////////////////////////////

var define;
var using;
(function() {
    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // verify environment support
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    var errMiss = "using.js: error-missing-feature. The '";
    var errMissTail = "' feature is not supported by the runtime.";
    if (!Function || !Function.prototype || !Function.prototype.bind) {
        if (typeof console != "undefined" && console.error) {
            console.error(errMiss + "Function.prototype.bind" + errMissTail);
        }
        else {
            throw errMiss + "Function.prototype.bind" + errMissTail;
        }
    }
    if (!Array || !Array.prototype || !Array.prototype.map) {
        if (typeof console != "undefined" && console.error) {
            console.error(errMiss + "Array.prototype.map" + errMissTail);
        }
        else {
            throw errMiss + "Array.prototype.map" + errMissTail;
        }
    }
    if (!Object || !Object.defineProperty) {
        if (typeof console != "undefined" && console.error) {
            console.error(errMiss + "Object.defineProperty" + errMissTail);
        }
        else {
            throw errMiss + "Object.defineProperty" + errMissTail;
        }
    }
    if (typeof Promise === "undefined") {
        if (typeof console != "undefined" && console.error) {
            console.error(errMiss + "Promise" + errMissTail);
        }
        else {
            throw errMiss + "Promise" + errMissTail;
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // Module class
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    function Module() {
        var self = this;

        this.id = null;
        this.dependencies = [];
        this.factory = null;
        this.parameters = null;

        // get a dependency by it's id (wildcard * allowed, takes highest alphanumeric match, keeps dots and slashes into account)
        this.dependencies.get = function(id, opt_updatable, request) {
            if (!self.dependencies || Object.prototype.toString.call(self.dependencies) !== "[object Array]") {
                return;
            }
            if (request && Object.prototype.toString.call(request) !== "[object Object]") {
                throw new Error(using.ERROR_INVALID_REQUEST, "Optional parameter 'request' should be an object of type 'Object'.");
            }

            // check directly
            if (self.dependencies[id] && self.dependencies[id] instanceof Module) {
                return self.dependencies[id].factory(request);
            }

            // compare by search string
            var dependencies;
            if (!opt_updatable || opt_updatable == "none") {
                dependencies = [];
                for (var d in self.dependencies) {
                    if (self.dependencies[d] instanceof Module) {
                        dependencies[self.dependencies[d].id] = self.dependencies[d];
                    }
                }
            }

            var sorted = sortById(dependencies? dependencies : cache, "desc");
            for (var d in sorted) {
                if (!isNaN(d) && sorted[d] instanceof Module && compareId(sorted[d].id, id, opt_updatable)) {
                    return sorted[d].factory(request);
                }
            }

            throw new Error(using.ERROR_DEPENDENCY_NOT_FOUND, "Dependency '" + id + "' could not be found.", self);
        };
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // Loader class
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    function Loader(request, loader) {
        var self = this;

        var done = false;
        var progress = 0;

        this.err = [];
        this.request = request;
        this.module = null;
        Object.defineProperty(self, "progress", {
            get: function() {
                return progress;
            },
            set: function(value) {
                progress = value;
                self.events.fire(using.EVENT_REQUEST_PROGRESS, progress);
            }
        });
        Object.defineProperty(self, "state", {
            get: function() {
                return ((self.module || done) && self.err.length == 0)? using.STATE_SUCCESS : (done? using.STATE_ERROR : using.STATE_INITIAL);
            }
        });

        this.events = new Emitter(this);

        // bind the fetch function to the loader function
        this.fetch = function(callback) {
            try {
                loader(function (module) {
                    if (done) {
                        self.err.push(new Error(using.ERROR_UNEXPECTED, "The Loader already finished, but tried to invoke the fetch callback again."));
                        return;
                    }
                    done = true;

                    if (module instanceof Module) {
                        self.module = module;
                        self.events.fire(using.EVENT_REQUEST_SUCCESS);
                    }
                    else if (module) {
                        self.err.push(new Error(using.ERROR_UNEXPECTED, "An unexpected error occurred in the Loader while trying to fetch the request '" + JSON.stringify(request) + "'. The Loader did not return an object of type 'Module'."));
                        self.events.fire(using.EVENT_REQUEST_ERROR);
                    }
                    else if (self.err.length > 0) {
                        self.events.fire(using.EVENT_REQUEST_ERROR);
                    }
                    else {
                        self.events.fire(using.EVENT_REQUEST_SUCCESS);
                    }

                    if (callback) {
                        if (Object.prototype.toString.call(callback) !== "[object Function]") {
                            self.err.push(new Error(using.ERROR_UNEXPECTED, "Optional parameter 'callback' should be an object of type 'Function'."));
                            self.events.fire(using.EVENT_REQUEST_ERROR);
                        }
                        else {
                            callback();
                        }
                    }
                });
            }
            catch(e) {
                done = true;

                self.err.push(new Error(using.ERROR_UNEXPECTED, "An unexpected error occurred in the Loader while trying to fetch the request '" + JSON.stringify(request) + "'.", e));
                self.events.fire(using.EVENT_REQUEST_ERROR);
            }
        };
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // Using class
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    function Using() {
        var self = this;

        var progress = 0;

        this.requests = [];
        this.err = [];
        Object.defineProperty(self, "progress", {
            get: function() {
                return progress;
            }
        });

        this.events = new Emitter(this);

        this.then = function(success, fail, bypassFactory) {
            var successClbk = success;
            var failClbk = fail;
            fail = function() {
                self.events.fire(using.EVENT_USING_ERROR);
                if (failClbk) {
                    failClbk.apply(failClbk, arguments);
                }
            };
            success = function() {
                self.events.fire(using.EVENT_USING_SUCCESS);
                if (successClbk) {
                    successClbk.apply(successClbk, arguments);
                }
            };

            // check for initialisation errors and empty request
            if (self.err.length > 0) {
                fail(self);
                return;
            }
            else if (self.requests.length == 0) {
                success();
                return;
            }

            // enumerate loaders
            for (var l=0;l<self.requests.length;l++) {
                self.requests[l].on([ using.EVENT_REQUEST_SUCCESS, using.EVENT_REQUEST_ERROR ], function(loader) {
                    var allDone = true;
                    var error = false;

                    // check state of all loaders
                    for (var r = 0; r < self.requests.length; r++) {
                        if (self.requests[r].state != using.STATE_SUCCESS &&
                            self.requests[r].state != using.STATE_ERROR) {
                            allDone = false;
                            break;
                        }
                        if (self.requests[r].state == using.STATE_ERROR) {
                            error = true;
                        }
                    }

                    if (allDone) {
                        if (error) {
                            fail(self);
                        }
                        else {
                            var results = [];
                            for (var r = 0; r < self.requests.length; r++) {
                                if (self.requests[r].module instanceof Module) {
                                    try {
                                        results[r] = bypassFactory? self.requests[r].module : (Object.prototype.toString.call(self.requests[r].module.factory) !== "[object Function]"? self.requests[r].module.factory : self.requests[r].module.factory(self.requests[r].request) );
                                    }
                                    catch (e) {
                                        self.err.push(new Error(using.ERROR_MODULE, e));
                                        fail(self);
                                        return;
                                    }
                                }
                                else {
                                    self.err.push(new Error(using.ERROR_UNEXPECTED, "Mandatory property 'module' should be an object of type 'Module'. An object of the '" + Object.prototype.toString.call(self.requests[r].module) + "' was provided."));
                                    fail(self);
                                    return;
                                }
                            }
                            success.apply(success, results);
                        }
                    }
                });
                self.requests[l].on(using.EVENT_REQUEST_PROGRESS, function(loader) {
                    // sum of all request progress
                    var p = 0;
                    for (var r = 0; r < self.requests.length; r++) {
                        p += self.requests[l].progress;
                    }
                    progress = p / self.requests.length;
                    self.events.fire(self.EVENT_USING_PROGRESS, progress);
                });
                try {
                    using.events.fire(using.EVENT_REQUEST, self.requests[l]);
                    self.requests[l].fetch();
                }
                catch(e) {
                    self.err.push(new Error(using.ERROR_UNEXPECTED, "The loader for request '" + JSON.stringify(self.requests[l].request) + "' has thrown an unexpected error.", e));
                    fail(self);
                }
            }
        };

        // fire new request event
        using.events.fire(using.EVENT_USING);
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // Emitter class
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    function Emitter(context) {
        var own = this;
        var callbacks = [];

        this.on = function (type, callback) {
            if (Object.prototype.toString.call(type) === "[object Array]") {
                for (var t in type) {
                    own.on(type[t], callback);
                }
                return;
            }
            var clb = { "callback" : callback, "type" : type };
            clb.id = callbacks.push(clb) - 1;

            return clb.id;
        };
        this.addEventListener = this.on;
        if (!context.addEventListener) {
            context.addEventListener = this.on;
        }
        if (!context.on) {
            context.on = this.on;
        }

        this.removeEventListener = function (id) {
            if (Object.prototype.toString.call(id) === "[object Function]") {
                for (var i in callbacks) {
                    if (callbacks[i].callback == id) {
                        callbacks.splice(i, 1);
                        i--;
                    }
                }
            }
            else {
                callbacks.splice(id, 1);
            }
        };
        if (!context.removeEventListener) {
            context.removeEventListener = this.removeEventListener;
        }

        this.fire = function (type, opt_arg) {
            for (var e = 0; e < callbacks.length; e++) {
                if (callbacks[e] != null && (callbacks[e].type == type || callbacks[e].type == "*")) {
                    try {
                        var a = [ context || global || window ];
                        for (var i in arguments) {
                            if (i == 0) {
                                continue;
                            }
                            a.push(arguments[i]);
                        }
                        if (callbacks[e].type == "*") {
                            a.unshift(type);
                        }
                        var retVal = callbacks[e].callback.apply(context, a);
                        if (retVal == true) {
                            return true;
                        }
                    }
                    catch(ex) {
                        if (Object.prototype.toString.call(callbacks[e].callback) !== "[object Function]") {
                            context.removeEventListener(e);
                            e--;
                        }
                    }
                }
            }
        };
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // define function
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    // in-memory cache that contains factories for javascript resources
    var cache = [];
    var cacheCounter = 0;

    define = function(/* optional */ id, /* optional */ dependencies, factory) {
        var parameters = {};
        var system = null;
        var errSrc = "define(id, dependencies, factory): Invalid module definition. ";

        // set correct parameters, from last to first
        if (Object.prototype.toString.call(dependencies) === "[object Function]") {
            factory = dependencies;
            dependencies = null;
        }
        if (Object.prototype.toString.call(id) === "[object Function]") {
            factory = id;
            id = null;
        }
        if (Object.prototype.toString.call(id) === "[object Array]") {
            dependencies = id;
            id = null;
        }


        // override parameters if set
        if (define.parameters) {
            if (Object.prototype.toString.call(define.parameters) === "[object Object]") {
                parameters = define.parameters;

                // override default ones
                id = id || parameters.id;
                dependencies = dependencies || parameters.dependencies;
                factory = factory || parameters.factory;
                system = parameters.system || system;
            }
            else {
                throw new TypeError(errSrc + "Optional define.parameters should be an object of type 'Object'.");
            }
        }

        // verify parameter type
        if (Object.prototype.toString.call(id) !== "[object String]" && id != null) {
            throw new TypeError(errSrc + "Optional parameter 'id' should be an object of type 'String'.");
        }
        if (dependencies != null) {
            if (Object.prototype.toString.call(dependencies) !== "[object Array]") {
                throw new TypeError(errSrc + "Optional parameter 'dependencies' should be an object of type 'Array'.");
            }
            else {
                for (var i=0;i<dependencies.length;i++) {
                    if (Object.prototype.toString.call(dependencies[i]) !== "[object String]" && Object.prototype.toString.call(dependencies[i]) !== "[object Object]") {
                        throw new TypeError(errSrc + "Optional parameter 'dependencies' should be an array of objects of type 'String'. Got: "+ Object.prototype.toString.call(dependencies[i]));
                    }
                }
            }
        }
        if (Object.prototype.toString.call(factory) !== "[object Function]" && Object.prototype.toString.call(factory) !== "[object Object]") {
            throw new TypeError(errSrc + "Mandatory parameter 'factory' should be of type 'Function' or 'Object'.");
        }

        if (Object.prototype.toString.call(system) !== "[object String]" && system) {
            throw new TypeError(errSrc + "Optional parameter 'system' should be an object of type 'String'.");
        }

        // add default dependencies if not set
        if (!dependencies) {
            dependencies = [];
        }
        if (dependencies.length == 0) {
            dependencies.push(using.DEPENDENCY_MODULE);
        }

        // create module
        var mod = new Module();
        mod.id = id;
        mod.parameters = parameters;

        // decorate dependencies
        for (var d in dependencies) {
            if (!isNaN(d)) {
                switch (dependencies[d]) {
                    case using.DEPENDENCY_MODULE:
                        dependencies[d] = mod;
                        break;
                }
            }
        }
        mod.dependencies.push.apply(mod.dependencies, dependencies);

        // module factory, this is where default dependencies are injected
        var f = function() {
            // check for missing dependencies
            for (var d in arguments) {
                if (!isNaN(d) && Object.prototype.toString.call(arguments[d]) === "[object String]") {
                    throw new RangeError(errSrc + "Dependency '" + arguments[d] + "' could not be resolved.");
                    //arguments[(parseInt(d)+1)] = null;
                }
            }

            // add context for binder
            Array.prototype.unshift.call(arguments, factory);

            return factory.apply(factory, arguments);
        };
        mod.factory = system? function(request) { return define.Loader.get(system).factory(mod, f, request); } : f;

        // create definition and add to memory cache
        cache[id || "mod-" + cacheCounter++] = mod;
    };
    // parameters for overriding default function parameters when calling define, or for
    // adding custom parameters that the loader can read
    define.parameters = {};

    // in-memory cache functions for finding modules
    define.cache = {};
    // get a module by it's id (wildcard * allowed, takes highest alphanumeric match, takes
    // dots and slashes into account)
    define.cache.get = function (id, opt_updatable) {
        if (!id) {
            var last;
            for (var i in cache) {
                last = cache[i];
            }
            return last;
        }
        if (opt_updatable) {
            var cacheSorted = sortById(cache, "desc");
            for (var m in cacheSorted) {
                if (compareId(cacheSorted[m].id, id, opt_updatable)) {
                    return cacheSorted[m];
                }
            }
        }

        if (cache[id]) {
            return cache[id];
        }
    };

    // if this function is called, the wait parameter is set. The module factory needs to
    // handle the wait promise.
    define.wait = function(fn) {
        define.parameters.wait = define.parameters.wait || [];
        //define.parameters.wait.push(new (Function.prototype.bind.apply(Promise, arguments)));
        var promise = new Promise(function(resolve, reject) {
            function waiterResolve() {
                promise.done = true;
                resolve();
            }

            function waiterReject() {
                promise.done = true;
                reject();
            }

            try {
                fn(waiterResolve, waiterReject);
            }
            catch(e) {
                promise.done = true;
                reject(e);
            }
        });

        define.parameters.wait.push(promise);
    };

    // loaders that process define requests
    var loaders = {};
    var loaderCallbacks = {};
    define.Loader = Loader;
    define.Loader.register = function(system, fn) {
        var errSrc = "define.loaders.register(system, fn): ";
        if (Object.prototype.toString.call(system) !== "[object String]") {
            throw new TypeError(errSrc + "Invalid loader. Mandatory parameter 'system' should be an object of type 'String'.");
        }
        if (Object.prototype.toString.call(fn) !== "[object Function]") {
            throw new TypeError(errSrc + "Invalid loader. Mandatory parameter 'fn' should be an object of type 'Function'.");
        }

        for (var l in loaders) {
            if (loaders[l] == fn) {
                throw new RangeError(errSrc + "Loader already registered.");
            }
        }

        if (loaders[system]) {
            throw new RangeError(errSrc + "A loader for module system '" + system + "' is already registered.");
        }

        loaders[system] = fn;

        while (loaderCallbacks[system] && loaderCallbacks[system].length > 0) {
            try {
                loaderCallbacks[system][0](fn);
            }
            catch(e) {
                if (typeof console != "undefined") {
                    console.error("An error occurred inside a loader registered callback for system '" + system + "'.", e);
                }
            }
            loaderCallbacks[system].splice(0,1);
        }
    };
    define.Loader.get = function(system) {
        var errSrc = "define.loaders.get(system): Invalid loader. ";
        if (Object.prototype.toString.call(system) !== "[object String]") {
            throw new TypeError(errSrc + "Mandatory parameter 'system' should be an object of type 'String'.");
        }
        if (!loaders[system]) {
            throw new RangeError(errSrc + "No loader was found for module system '" + system + "'.");
        }

        return loaders[system];
    };
    define.Loader.waitFor = function(system, callback) {
        if (loaders[system]) {
            callback(loaders[system]);
            return;
        }

        loaderCallbacks[system] = loaderCallbacks[system] || [];
        loaderCallbacks[system].push(callback);
    };

    // module definition object
    define.Module = Module;

    // require files in the context of the given id
    var requireCache = [];
    define.getRequire = function(moduleId, original) {
        return function(id, opt_updatable) {
            if (!moduleId || !cache[moduleId]) {
                if (typeof require === "function") {
                    if (!requireCache[id]) {
                        requireCache[id] = require(id);
                    }
                    return requireCache[id];
                }
                return function () {
                    throw new Error("Runtime environment does not implement 'require'.");
                };
            }
            // try original require first
            var result;
            if (original) {
                try {
                    result = original(id);
                }
                catch(e) {
                    if (e.code !== "MODULE_NOT_FOUND") {
                        throw e;
                    }
                    // parse get string
                    if (id.substr(0,2) == "./") {
                        id = id.substr(2);

                        try {
                            result = original(id);
                        }
                        catch(e) {
                            if (e.code !== "MODULE_NOT_FOUND") {
                                throw e;
                            }
                            // the original could not resolve
                            result = null;
                        }
                    }
                }
            }
            if (!result) {
                result = cache[moduleId].dependencies.get(id, opt_updatable);
            }
            return result;
        };
    };

    // this property can be used to check if define is the using.js variant instead of the
    // AMD variant
    define.using = true;

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // using function
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    using = function() {
        // create handler
        var handler = new Using();

        // enumerate requests
        for(var a=0;a<arguments.length;a++) {
            var request = arguments[a];
            var match = false;

            // check request object validity
            if (Object.prototype.toString.call(arguments[a]) !== "[object Object]" &&
                Object.prototype.toString.call(arguments[a]) !== "[object String]") {
                throw new TypeError("using(): Each of the arguments passes should be an object of type 'Object' or an object of type 'String'.");
            }

            // enumerate an try the loaders one by one in order of registration for this request
            for (var l in loaders) {
                var loader = null;
                try {
                    loader = new loaders[l](request);
                } catch(e) {
                    if (!(e instanceof RangeError)) {
                        handler.err.push(new Error(using.ERROR_UNEXPECTED, "The loader for request '" + JSON.stringify(request) + "' has thrown an unexpected error.", e, request));
                    }
                    else {
                        handler.err.push(new Error(using.WARNING_REQUEST_NOT_ACCEPTED, "Loader '" + l + "' did not accept request '" + JSON.stringify(request) + "'.", e, request));
                    }
                    // try other loaders
                    continue;
                }

                if (loader instanceof Loader) {
                    handler.requests.push(loader);
                    match = true;
                    break;
                }
                else {
                    handler.err.push(new Error(using.ERROR_UNEXPECTED, "The loader did not return an object of type 'Loader'.", loaders[l]));
                }
            }

            if (!match) {
                handler.err.push(new Error(using.ERROR_UNSUPPORTED_REQUEST, "Unsupported request '" + JSON.stringify(request) + "', no loader was found.", request));
            }
        }

        return handler;
    };
    // create static event emitter
    using.events = new Emitter(using);

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // constants
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    using.EVENT_USING = "event-using";
    using.EVENT_USING_PROGRESS = "event-using-progress";
    using.EVENT_USING_SUCCESS = "event-using-success";
    using.EVENT_USING_ERROR = "event-using-error";
    using.EVENT_REQUEST = "event-request";
    using.EVENT_REQUEST_PROGRESS = "event-request-progress";
    using.EVENT_REQUEST_SUCCESS = "event-request-success";
    using.EVENT_REQUEST_ERROR = "event-request-error";
    using.EVENT_PACKAGE_MOUNT_ERROR = "event-package-mount-error";
    using.EVENT_PACKAGE_MOUNT_SUCCESS = "event-package-mount-success";
    using.STATE_INITIAL = "state-initial";
    using.STATE_SUCCESS = "state-success";
    using.STATE_ERROR = "state-error";
    using.DEPENDENCY_MODULE = "module";
    using.ERROR_PACKAGE = "error-package";
    using.ERROR_INVALID_REQUEST = "error-invalid-request";
    using.ERROR_UNSUPPORTED_REQUEST = "error-unsupported-request";
    using.ERROR_MODULE = "error-module";
    using.ERROR_UNEXPECTED = "error-unexpected";
    using.ERROR_DEPENDENCY_NOT_FOUND = "error-dependency-not-found";
    using.WARNING_REQUEST_NOT_ACCEPTED = "warning-request-not-accepted";
    define.ERROR_INVALID_REQUEST_HANDLER = "error-invalid-request-handler";

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // utility functions
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    function sortById(arr, order) {
        var props = [];
        for (var p in arr) {
            props.push(p);
        }

        var sort = {
            asc: function (a, b) {
                var reA = /[^a-zA-Z]/g;
                var reN = /[^0-9]/g;
                for (var l=0;l < Math.min(a.value.length, b.value.length); l++) {
                    if (a.value[l] === b.value[l]) {
                        continue;
                    }
                    // put numbers before strings
                    if (!isNaN(a.value[l]) && isNaN(b.value[l])) {
                        return 1;
                    }
                    if (isNaN(a.value[l]) && !isNaN(b.value[l])) {
                        return -1;
                    }
                    // compare
                    var aA = a.value[l].replace(reA, "");
                    var bA = b.value[l].replace(reA, "");
                    if(aA === bA) {
                        var aN = parseInt(a.value[l].replace(reN, ""), 10);
                        var bN = parseInt(b.value[l].replace(reN, ""), 10);
                        //return aN === bN ? 0 : aN > bN ? 1 : -1;
                        if (aN === bN) {
                            continue;
                        }
                        return aN > bN ? 1 : -1;
                    } else {
                        return aA > bA ? 1 : -1;
                    }
                }
                return 0;
            },
            desc: function (a, b) {
                return sort.asc(b, a);
            }
        };

        var mapped = props.map(function (el, i) {
            return { index: i, value: el.split(/[\.\/]+/), name : el };
        });

        mapped.sort(sort[order] || sort.asc);

        return mapped.map(function (el) {
            return arr[el.name];
        });
    }

    function compareId(str, search, opt_updatable) {
        var strRes = str.split("/");
        str = strRes[0];
        strRes = strRes.join("/").substr(str.length);
        var searchRes = search.split("/");
        search = searchRes[0];
        searchRes = searchRes.join("/").substr(search.length);
        var groups = 0;
        switch (opt_updatable) {
            case "patch":
                groups = 1;
                break;
            case "minor":
                groups = 2;
                break;
            case "major":
                groups = 3;
                break;
        }
        if (groups === 0) {
            return str == search;
        }
        var parts = search.split(".");
        var numbers = 0;
        for (var p = parts.length; p > 0; p--) {
            if (isNaN(parts[p - 1])) {
                break;
            }
            numbers++;
        }
        var match = str.split(".");
        // if parts are not equal, they can't match
        if (match.length != (parts.length - numbers) + 3 || strRes != searchRes) {
            return false;
        }
        // check if id string without number parts match
        for (var p = 0; p < parts.length - numbers; p++) {
            if (match.length < p || match[p] != parts[p]) {
                return false;
            }
        }
        // check the number parts
        for (var g = 0; g < 3; g++) {
            if (g < 3 - numbers) {
                continue;
            }
            if (g < groups && match[match.length - 1 - g] < parts[parts.length - 1 - (g - (3 - numbers))]) {
                return false;
            }
            else if(g >= groups && match[match.length - 1 - g] != parts[parts.length - 1 - (g - (3 - numbers))]) {
                return false;
            }
        }

        return true;
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    //
    // post-initialisation
    //
    /////////////////////////////////////////////////////////////////////////////////////////
    // add to global scope
    if (typeof global != "undefined") {
        global.using = using;
        global.define = define;
    }
})();

if (typeof require === "function" && require.main) {
    module.exports = using;
}