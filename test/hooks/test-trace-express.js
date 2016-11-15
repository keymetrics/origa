/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

var traceLabels = require('../../lib/trace-labels.js');
var http = require('http');
var assert = require('assert');
var constants = require('../../lib/constants.js');
var common = require('./common.js');
var express = require('./fixtures/express4');

var server;
var write;

describe('test-trace-express', function() {
  before(function() {
    // Mute stderr to satiate appveyor
    write = process.stderr.write;
    process.stderr.write = function(c, e, cb) {
      assert.equal(c, 1729);
      if (cb) {
        cb();
      }
    };
  });
  after(function() {
    process.stderr.write = write;
  });
  afterEach(function() {
    common.cleanTraces();
    server.close();
  });

  it('should accurately measure get time, get', function(done) {
    var app = express();
    app.get('/', function (req, res) {
      setTimeout(function() {
        res.send(common.serverRes);
      }, common.serverWait);
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('GET', done, expressPredicate);
    });
  });

  it('should accurately measure get time, route', function(done) {
    var app = express();
    app.route('/').all(function(req, res, next) {
      setTimeout(function() {
        next();
      }, common.serverWait);
    }).get(function(req,res,next) {
      res.send(common.serverRes);
      next();
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('GET', done, expressPredicate);
    });
  });

  it('should accurately measure get time, post', function(done) {
    var app = express();
    app.post('/', function (req, res) {
      setTimeout(function() {
        res.send(common.serverRes);
      }, common.serverWait);
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('POST', done, expressPredicate);
    });
  });

  it('should accurately measure get time, put', function(done) {
    var app = express();
    app.put('/', function (req, res) {
      setTimeout(function() {
        res.send(common.serverRes);
      }, common.serverWait);
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('PUT', done, expressPredicate);
    });
  });

  it('should accurately measure get time, param', function(done) {
    var app = express();
    app.param('id', function(req, res, next) {
      setTimeout(function() {
        next();
      }, common.serverWait / 2);
    });
    app.get('/:id', function (req, res) {
      setTimeout(function() {
        res.send(common.serverRes);
      }, common.serverWait / 2);
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('GET', done, expressParamPredicate, '/:id');
    });
  });

  it('should accurately measure get time, middleware', function(done) {
    var app = express();
    app.use(function(req, res, next) {
      setTimeout(function() {
        next();
      }, common.serverWait / 2);
    });
    app.get('/', function (req, res) {
      setTimeout(function() {
        res.send(common.serverRes);
      }, common.serverWait / 2);
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('GET', done, expressPredicate);
    });
  });

  it('should accurately measure get time, middleware only', function(done) {
    var app = express();
    app.use(function(req, res, next) {
      setTimeout(function() {
        res.send(common.serverRes);
        next();
      }, common.serverWait);
    });
    server = app.listen(common.serverPort, function() {
      common.doRequest('GET', done, expressPredicate);
    });
  });

  it('should have proper labels', function(done) {
    var app = express();
    app.get('/', function (req, res) {
      res.send(common.serverRes);
    });
    server = app.listen(common.serverPort, function() {
      http.get({port: common.serverPort}, function(res) {
        var labels = common.getMatchingSpan(expressPredicate).labels;
        assert.equal(labels[traceLabels.HTTP_RESPONSE_CODE_LABEL_KEY], '200');
        assert.equal(labels[traceLabels.HTTP_METHOD_LABEL_KEY], 'GET');
        assert.equal(labels[traceLabels.HTTP_URL_LABEL_KEY], 'http://localhost/');
        assert(labels[traceLabels.HTTP_SOURCE_IP]);
        done();
      });
    });
  });

  it('should remove trace frames from stack', function(done) {
    var app = express();
    app.get('/', function (req, res) {
      res.send(common.serverRes);
    });
    server = app.listen(common.serverPort, function() {
      http.get({port: common.serverPort}, function(res) {
        var labels = common.getMatchingSpan(expressPredicate).labels;
        var stackTrace = JSON.parse(labels[traceLabels.STACK_TRACE_DETAILS_KEY]);
        // Ensure that our middleware is on top of the stack
        assert.equal(stackTrace.stack_frame[0].method_name, 'middleware');
        done();
      });
    });
  });

  it('should not include query parameters in span name', function(done) {
    var app = express();
    app.get('/', function (req, res) {
      res.send(common.serverRes);
    });
    server = app.listen(common.serverPort, function() {
      http.get({path: '/?a=b', port: common.serverPort}, function(res) {
        var name = common.getMatchingSpan(expressPredicate).name;
        assert.equal(name, '/');
        done();
      });
    });
  });

  it('should handle thrown errors from get', function(done) {
    var app = express();
    app.get('/', function(req, res) {
      throw common.serverRes;
    });
    server = app.listen(common.serverPort, function() {
      http.get({port: common.serverPort}, function(res) {
        var labels = common.getMatchingSpan(expressPredicate).labels;
        assert.equal(labels[traceLabels.HTTP_RESPONSE_CODE_LABEL_KEY], '500');
        done();
      });
    });
  });

  it('should handle thrown errors from middleware', function(done) {
    var app = express();
    app.use(function(req, res, next) {
      throw common.serverRes;
    });
    server = app.listen(common.serverPort, function() {
      http.get({port: common.serverPort}, function(res) {
        var labels = common.getMatchingSpan(expressPredicate).labels;
        assert.equal(labels[traceLabels.HTTP_RESPONSE_CODE_LABEL_KEY], '500');
        done();
      });
    });
  });

  it('should set trace context on response', function(done) {
    var app = express();
    app.get('/', function (req, res) {
      res.send(common.serverRes);
    });
    server = app.listen(common.serverPort, function() {
      http.get({port: common.serverPort}, function(res) {
        assert(
          res.headers[constants.TRACE_CONTEXT_HEADER_NAME].indexOf(';o=1') !== -1);
        done();
      });
    });
  });
});

function expressPredicate(span) {
  return span.name === '/';
}

function expressParamPredicate(span) {
  return span.name === '/:id';
}
