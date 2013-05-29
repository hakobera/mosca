var pkg = require("../package");
var commander = require("commander");
var path = require("path");
var Authorizer = require("./authorizer");
var fs = require("fs");
var async = require("async");

/**
 * Load a new Authorizer
 *
 * @api private
 * @param {commander.Command} program the specified options from the command line
 * @param {Function} cb The callback that will invoked with the authorizer
 */
function loadAuthorizer(program, cb) {
  if (program.credentials) {
    fs.readFile(program.credentials, function(err, data) {
      if (err) {
        cb(err);
        return;
      }

      var authorizer = new Authorizer();

      try {
        authorizer.users = JSON.parse(data);
        cb(null, authorizer);
      } catch(err) {
        cb(err);
      }
    });
  } else {
    cb(null, null);
  }
}

/**
 * Start a new server
 *
 * @api private
 * @param {Function} pre the callback to call before doing anything
 * @param {commander.Command} program the parsed argument
 * @param {Function} callback the callback to call when finished
 */
function start(pre, program, callback) {
  return function() {
    pre();

    // this MUST be done after changing the DEBUG env
    var Server = require("./server");
    var server = null;

    var opts = {
      backend: {}
    };
    opts.port = program.port;

    if (program.parentPort || program.parentHost) {
      opts.backend.type = "mqtt";
      opts.backend.port = 1883;
    }

    if (program.parentHost) {
      opts.backend.host = program.parentHost;
    }

    if (program.parentPort) {
      opts.backend.port = program.parentPort;
    }

    opts.backend.prefix = program.parentPrefix;

    if (program.config) {
      opts = require(path.join(process.cwd(), program.config));
    }

    var setupAuthorizer = function(cb) {
      process.on("SIGHUP", setupAuthorizer);
      server.on("closed", function() {
        process.removeListener("SIGHUP", setupAuthorizer);
      });

      loadAuthorizer(program, function(err, authorizer) {
        if (err) {
          callback(err);
          return;
        }

        if (authorizer) {
          server.authenticate = authorizer.authenticate;
          server.authorizeSubscribe = authorizer.authorizeSubscribe;
          server.authorizePublish = authorizer.authorizePublish;
        }

        cb(null, server);
      });

      return false;
    };

    async.series([
      function(cb) {
        server = new Server(opts);
        server.on("ready", cb);
      },
      setupAuthorizer
    ], function(err, results) {
      callback(err, results[1]);
    });

    return server;
  };
}

/**
 * The basic command line interface of Mosca.
 *
 * @api private
 */
module.exports = function cli(argv, callback) {

  argv = argv || [];

  var program = new commander.Command();
  var server = null;
  var runned = false;

  callback = callback || function() {};

  program
  .version(pkg.version)
  .option("-p, --port <n>", "the port to listen to", parseInt)
  .option("--parent-port <n>", "the parent port to connect to", parseInt)
  .option("--parent-host <s>", "the parent host to connect to")
  .option("--parent-prefix <s>", "the prefix to use in the parent broker")
  .option("--credentials <file>", "the file containing the credentials", null, "./credentials.json")
  .option("--authorize-publish <pattern>", "the pattern for publishing to topics for the added user")
  .option("--authorize-subscribe <pattern>", "the pattern for subscribing to topics for the added user")
  .option("-c, --config <c>", "the config file to use (override every other option)")
  .option("-v, --verbose", "equal to DEBUG=mosca")
  .option("--very-verbose", "equal to DEBUG=mosca,ascoltatori:*");

  var setupVerbose = function() {
    runned = true;
    if (program.veryVerbose) {
      process.env.DEBUG = "mosca,ascoltatori:*";
    } else if (program.verbose) {
      process.env.DEBUG = "mosca";
    }
  };

  var loadAuthorizerAndSave = function (cb) {
    setupVerbose();

    loadAuthorizer(program, function (err, authorizer) {
      if (err) {
        authorizer = new Authorizer();
      }

      cb(null, authorizer, function(err) {
        if (err) {
          callback(err);
          return;
        }
        fs.writeFile(program.credentials, JSON.stringify(authorizer.users, null, 2), callback);
      });
    });
  };

  var adduser = function (username, password) {
    loadAuthorizerAndSave(function(err, authorizer, done) {
      authorizer.addUser(username, password, program.authorizePublish,
                         program.authorizeSubscribe, done);
    });
  };

  var rmuser = function (username) {
    loadAuthorizerAndSave(function(err, authorizer, done) {
      authorizer.rmUser(username, done);
    });
  };

  program.
    command("adduser <user> <pass>").
    description("Add a user to the given credentials file").
    action(adduser);

  program.
    command("rmuser <user>").
    description("Removes a user from the given credentials file").
    action(rmuser);

  var doStart = start(setupVerbose, program, callback);

  program.
    command("start").
    description("start the server (optional)").
    action(doStart);

  program.parse(argv);

  if (!runned) {
    doStart();
  }
};