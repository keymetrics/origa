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

var assert = require('assert');
var cls = require('../../lib/cls.js');
var agent = require('../..');
var request = require('request');


process.env.VXX_PROJECT = 0;

var queueSpans = function(n, privateAgent) {
  for (var i = 0; i < n; i++) {
    privateAgent.createRootSpanData('name', 1, 0).close();
  }
};

var formatBuffer = function(buffer) {
  return {
    traces: buffer.map(function(e) { return JSON.parse(e); })
  };
};

describe('tracewriter publishing', function() {

  it.skip('should publish on unhandled exception', function(done) {
    process.removeAllListeners('uncaughtException'); // Remove mocha handler
    var buf;
    process.on('uncaughtException', function() {
      setTimeout(function() {
        assert.equal(process.listeners('uncaughtException').length, 2);
        agent.stop();
        assert.equal(process.listeners('uncaughtException').length, 1);
        scope.done();
        done();
      }, 20);
    });
    process.nextTick(function() {
      var privateAgent = agent.start({
        bufferSize: 1000,
        samplingRate: 0,
        onUncaughtException: 'flush'
      }).private_();
      privateAgent.traceWriter.request_ = request; // Avoid authing
      cls.getNamespace().run(function() {
        queueSpans(2, privateAgent);
        buf = privateAgent.traceWriter.buffer_;
        throw new Error(':(');
      });
    });
  });

});
