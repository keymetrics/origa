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

var agent = require('../..').start({ samplingRate: 0 }).private_();

var common = require('../hooks/common.js');
var assert = require('assert');
var express = require('../hooks/fixtures/express4');
var http = require('http');

var versions = {
  grpc1: require('../hooks/fixtures/grpc1')
};

var grpcPort = 50051;
var protoFile = __dirname + '/../fixtures/test-grpc.proto';
var client, grpcServer, server;

agent.logger.debug = function(error, uri) {
  if (error.indexOf('http') !== -1) {
    assert.notStrictEqual(uri.indexOf('localhost'), -1);
  }
};

function makeHttpRequester(callback, expectedReqs) {
  var pendingHttpReqs = expectedReqs;
  return function() {
    http.get('http://www.google.com/', function(httpRes) {
      httpRes.on('data', function() {});
      httpRes.on('end', function() {
        if (--pendingHttpReqs === 0) {
          callback();
        }
      });
    });
  };
}

function requestAndSendHTTPStatus(res, expectedReqs) {
  return makeHttpRequester(function () {
    res.sendStatus(200);
  }, expectedReqs);
}

Object.keys(versions).forEach(function(version) {
  var grpc = versions[version];

  describe('express + ' + version, function() {
    before(function(done) {
      var proto = grpc.load(protoFile).nodetest;
      var app = express();

      app.get('/unary', function(req, res) {
        var httpRequester = requestAndSendHTTPStatus(res, 1);
        client.testUnary({n: 42}, httpRequester);
      });

      app.get('/client', function(req, res) {
        var httpRequester = requestAndSendHTTPStatus(res, 1);
        var stream = client.testClientStream(httpRequester);
        for (var i = 0; i < 10; ++i) {
          stream.write({n: i});
        }
        stream.end();
      });

      app.get('/server', function(req, res) {
        var httpRequester = requestAndSendHTTPStatus(res, 11);
        var stream = client.testServerStream();
        stream.on('data', httpRequester);
        stream.on('status', httpRequester);
      });

      app.get('/bidi', function(req, res) {
        var httpRequester = requestAndSendHTTPStatus(res, 11);
        var stream = client.testBidiStream();
        stream.on('data', httpRequester);
        stream.on('status', httpRequester);
        for (var i = 0; i < 10; ++i) {
          stream.write({n: i});
        }
        stream.end();
      });

      client = new proto.Tester('localhost:' + grpcPort,
          grpc.credentials.createInsecure());

      server = app.listen(common.serverPort, function() {
        grpcServer = new grpc.Server();
        grpcServer.addProtoService(proto.Tester.service, {
          testUnary: function(call, cb) {
            var httpRequester = makeHttpRequester(function () {
              cb(null, {n: call.request.n});
            }, 1);
            httpRequester();
          },
          testClientStream: function(call, cb) {
            var httpRequester = makeHttpRequester(function () {
              cb(null, {n: 43});
            }, 11);
            call.on('data', httpRequester);
            call.on('end', httpRequester);
          },
          testServerStream: function(stream) {
            var httpRequester = makeHttpRequester(function () {
              stream.end();
            }, 1);
            for (var i = 0; i < 10; ++i) {
              stream.write({n: i});
            }
            httpRequester();
          },
          testBidiStream: function(stream) {
            var httpRequester = makeHttpRequester(function () {
              stream.end();
            }, 11);
            stream.on('data', function(data) {
              stream.write({n: data.n});
              httpRequester();
            });
            stream.on('end', httpRequester);
          }
        });
        grpcServer.bind('localhost:' + grpcPort,
            grpc.ServerCredentials.createInsecure());
        grpcServer.start();
        done();
      });
    });

    after(function() {
      grpcServer.forceShutdown();
      server.close();
    });

    afterEach(function() {
      common.cleanTraces();
    });

    it('grpc should preserve context for unary requests', function(done) {
      http.get({port: common.serverPort, path: '/unary'}, function(res) {
        assert.strictEqual(common.getTraces().length, 2);
        // gRPC Server: 1 root span, 1 http span.
        assert.strictEqual(common.getTraces()[0].spans.length, 2);
        assert.strictEqual(common.getTraces()[0].spans[0].kind, 'RPC_SERVER');
        // gRPC Client: 1 root span from express, 1 gRPC span, 1 http span.
        assert.strictEqual(common.getTraces()[1].spans.length, 3);
        done();
      });
    });

    it('grpc should preserve context for client requests', function(done) {
      http.get({port: common.serverPort, path: '/client'}, function(res) {
        assert.strictEqual(common.getTraces().length, 2);
        // gRPC Server: 1 root span, 11 http spans (10 from 'data' listeners,
        // 1 from 'end' listener).
        assert.strictEqual(common.getTraces()[0].spans.length, 12);
        assert.strictEqual(common.getTraces()[0].spans[0].kind, 'RPC_SERVER');
        // gRPC Client: 1 root span from express, 1 gRPC span, 1 http span.
        assert.strictEqual(common.getTraces()[1].spans.length, 3);
        done();
      });
    });

    it('grpc should preserve context for server requests', function(done) {
      http.get({port: common.serverPort, path: '/server'}, function(res) {
        assert.strictEqual(common.getTraces().length, 2);
        // gRPC Server: 1 root span, 1 http span.
        assert.strictEqual(common.getTraces()[0].spans.length, 2);
        assert.strictEqual(common.getTraces()[0].spans[0].kind, 'RPC_SERVER');
        // gRPC Client: 1 root span from express, 1 gRPC span, and 11 http spans
        // (10 from 'data' listeners and 1 from the 'status' listener).
        assert.strictEqual(common.getTraces()[1].spans.length, 13);
        done();
      });
    });

    it('grpc should preserve context for bidi requests', function(done) {
      http.get({port: common.serverPort, path: '/bidi'}, function(res) {
        assert.strictEqual(common.getTraces().length, 2);
        // gRPC Server: 1 root span, 11 http spans (10 from 'data' listeners,
        // 1 from 'end' listener).
        assert.strictEqual(common.getTraces()[0].spans.length, 12);
        assert.strictEqual(common.getTraces()[0].spans[0].kind, 'RPC_SERVER');
        // gRPC Client: 1 root span from express, 1 gRPC span, and 11 http spans
        // (10 from 'data' listeners and 1 from the 'status' listener).
        assert.strictEqual(common.getTraces()[1].spans.length, 13);
        done();
      });
    });
  });
});
