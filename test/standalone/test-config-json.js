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

var path = require('path');
var assert = require('assert');

// Default configuration:
// { logLevel: 1, stackTraceLimit: 0, flushDelaySeconds: 30, samplingRate: 10 };

// Fixtures configuration:
// { logLevel: 4, stackTraceLimit: 1 };
process.env.VXX_CONFIG_PATH =
  path.join('test', 'fixtures', 'test-config.json');

var agent = require('../..').start();

describe('json config', function() {
  it('should load trace config from json file', function() {
    var config = agent.private_().config_;
    assert.equal(config.logLevel, 4);
  });
});
