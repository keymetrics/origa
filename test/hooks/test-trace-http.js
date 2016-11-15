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

var common = require('./common.js');
var constants = require('../../lib/constants.js');
var TraceLabels = require('../../lib/trace-labels.js');

var assert = require('assert');
var http = require('http');

var server = http.Server(function(req, res) {
  setTimeout(function() {
    res.writeHead(200);
    res.end(common.serverRes);
  }, common.serverWait);
});

describe('test-trace-http', function() {
  afterEach(function() {
    common.cleanTraces();
    server.close();
  });

  it('should accurately measure get time with callback', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        http.get({port: common.serverPort}, function(res) {
          var result = '';
          res.on('data', function(data) { result += data; });
          res.on('end', function() {
            endTransaction();
            assert.equal(common.serverRes, result);
            common.assertDurationCorrect();
            done();
          });
        });
      })
    );
  });

  it('should accurately measure get time, no callback', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        http.get({port: common.serverPort, headers: {}});
        setTimeout(function() {
          endTransaction();
          common.assertDurationCorrect();
          done();
        }, common.serverWait * 1.5);
      })
    );
  });

  it('should not trace api requests', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        var headers = {};
        headers[constants.TRACE_API_HEADER_NAME] = 'yay';
        http.get({port: common.serverPort, headers: headers});
        setTimeout(function() {
          endTransaction();
          // The only trace present should be the outer transaction
          var traces = common.getTraces();
          assert.equal(traces.length, 1);
          assert.equal(traces[0].spans[0].name, 'outer');
          done();
        }, common.serverWait * 1.5);
      })
    );
  });

  it('should not break with no target', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        http.get().on('error', function(err) {
          endTransaction();
          done();
        });
      })
    );
  });

  it('should accurately measure get time, string url', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        http.get('http://localhost:' + common.serverPort);
        setTimeout(function() {
          endTransaction();
          done();
        }, common.serverWait * 1.5);
      })
    );
  });

  it('should not include query parameters in span name', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        http.get('http://localhost:' + common.serverPort + '/?foo=bar');
        setTimeout(function() {
          endTransaction();
          var traces = common.getTraces();
          assert.equal(traces.length, 1);
          assert.equal(traces[0].spans[1].name, 'localhost');
          done();
        }, common.serverWait * 1.5);
      })
    );
  });

  it('should accurately measure get time, error', function(done) {
    var server = http.Server(function(req, res) {
      setTimeout(function() {
        res.writeHead(200);
        res.end(common.serverRes);
      }, 10000);
    });
    server.timeout = common.serverWait;
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        var req = http.get({port: common.serverPort});
        req.on('error', function() {
          endTransaction();
          common.assertDurationCorrect();
          var span = common.getMatchingSpan(function(span) { 
            return span.name !== 'outer'; 
          });
          assert.equal(span.labels[TraceLabels.ERROR_DETAILS_NAME],
              'Error');
          assert.equal(span.labels[TraceLabels.ERROR_DETAILS_MESSAGE],
              'socket hang up');
          server.close();
          done();
        });
      })
    );
  });

  it('should accurately measure get time, event emitter', function(done) {
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        var req = http.get({port: common.serverPort});
        req.on('response', function(res) {
          var result = '';
          res.on('data', function(data) { result += data; });
          res.on('end', function() {
            endTransaction();
            assert.equal(common.serverRes, result);
            common.assertDurationCorrect();
            done();
          });
        });
      })
    );
  });

  it('should accurately measure request time', function(done) {
    var server = http.Server(function(req, res) {
      setTimeout(function() {
        res.writeHead(200);
        res.end(common.serverRes);
      }, common.serverWait / 2);
    });
    server.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        var req = http.request({port: common.serverPort}, function(res) {
          var result = '';
          res.on('data', function(data) { result += data; });
          res.on('end', function() {
            endTransaction();
            assert.equal(common.serverRes, result);
            common.assertDurationCorrect();
            server.close();
            done();
          });
        });
        setTimeout(function() {
          req.end();
        }, common.serverWait / 2);
      })
    );
  });

  it('should handle concurrent requests', function(done) {
    this.timeout(10000); // this test takes a long time
    var count = 200;
    var slowServer = http.Server(function(req, res) {
      setTimeout(function() {
        res.writeHead(count++);
        res.end();
      }, 5000);
    });
    slowServer.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        var completed = 0;
        var handleResponse = function(res) {
          var result = '';
          res.on('data', function(data) { result += data; });
          res.on('end', function() {
            if (++completed === 5) {
              endTransaction();
              var spans = common.getMatchingSpans(function(span) {
                return span.name !== 'outer';
              });
              assert.equal(spans.length, 5);
              // We need to check a property attached at the end of a span
              var statusCodes = [];
              var labels = require('../../lib/trace-labels.js');
              for (var j = 0; j < spans.length; j++) {
                var code = Number(spans[j].labels[
                    labels.HTTP_RESPONSE_CODE_LABEL_KEY]);
                assert.equal(statusCodes.indexOf(code), -1);
                statusCodes.push(code);
              }
              assert.equal(statusCodes.reduce(function(a, b) { return a + b; }), 1010);
              slowServer.close();
              done();
            }
          });
        };
        for (var i = 0; i < 5; i++) {
          http.get({port: common.serverPort}, handleResponse);
        }
      })
    );
  });
});

describe('https', function() {
  afterEach(function() {
    common.cleanTraces();
  });

  it('should accurately measure https#get time with callback', function(done) {
    var https = require('https');

    var options = {
      key: common.serverKey,
      cert: common.serverCert
    };

    var secureServer = https.createServer(options, function(req, res) {
      setTimeout(function() {
        res.writeHead(200);
        res.end(common.serverRes);
      }, common.serverWait);
    });
    secureServer.listen(common.serverPort, common.runInTransaction.bind(null,
      function(endTransaction) {
        https.get({port: common.serverPort, rejectUnauthorized: false}, function(res) {
          var result = '';
          res.on('data', function(data) { result += data; });
          res.on('end', function() {
            endTransaction();
            assert.equal(common.serverRes, result);
            common.assertDurationCorrect();
            secureServer.close();
            done();
          });
        });
      })
    );
  });
});
