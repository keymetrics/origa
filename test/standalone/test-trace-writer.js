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

var queueSpans = function(n, privateAgent) {
  for (var i = 0; i < n; i++) {
    privateAgent.createRootSpanData('name', 1, 0).close();
  }
};

describe('tracewriter publishing', function() {

  it('should publish when queue fills', function(done) {
    var buf;
    var privateAgent = agent.start({bufferSize: 2, samplingRate: 0}).private_();
    cls.getNamespace().run(function() {
      queueSpans(1, privateAgent);

      privateAgent.traceWriter.on('transaction', function (trace) {
        privateAgent.stop();
        done();
      })
    });
  });
});
