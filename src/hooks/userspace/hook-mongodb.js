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

var traceUtil = require('../../util.js');
var cls = require('../../cls.js');
var shimmer = require('shimmer');
var semver = require('semver');
var SpanData = require('../../span-data.js');
var agent;

var SUPPORTED_VERSIONS = '1 - 2';

function wrapWithLabel(label) {
  return function(original) {
    return function mongo_operation_trace() {
      var root = cls.getRootContext();
      if (!root || root === SpanData.nullSpan) {
        agent.logger.debug('Untraced mongo command:', JSON.stringify(arguments[0]));
        return original.apply(this, arguments);
      }

      var labels = { query: JSON.stringify(arguments[0]), collection: this.collectionName };
      agent.logger.debug('Starting mongo span with %s', JSON.stringify(labels))
      var span = agent.startSpan(label, labels);
      var callbackPos = traceUtil.findCallbackArg(arguments);
      var orignCallback = arguments[callbackPos];

      if (callbackPos) {
        arguments[callbackPos] = wrapCallback(span, orignCallback)
      }
      return original.apply(this, arguments);
    };
  };
}

/**
 * Wraps the provided callback so that the provided span will
 * be closed before the callback is invoked.
 *
 * @param {Span} span The span to be closed.
 * @param {Function} done The callback to be wrapped.
 * @return {Function} The wrapped function.
 */
function wrapCallback(span, done) {
  var fn = function(err, res) {
    var labels = {};
    if (agent.config_.enhancedDatabaseReporting) {
      if (err) {
        labels.mongoError = err;
      }
      if (res) {
        var result = res.result ? res.result : res;
        labels.results = traceUtil.stringifyPrefix(result,
          agent.config_.databaseResultReportingSize);
      }
    }
    agent.endSpan(span, labels);
    agent.logger.debug('Ending mongo span with %s', JSON.stringify(labels))
    if (done) {
      done(err, res);
    }
  };
  return cls.getNamespace().bind(fn);
}

module.exports = function(version_, agent_) {
  if (!semver.satisfies(version_, SUPPORTED_VERSIONS)) {
    agent_.logger.info('Mongo: unsupported version ' + version_ + ' loaded');
    return {};
  }
  return {
    // An empty relative path here matches the root module being loaded.
    '': {
      patch: function(mongo) {
        agent = agent_;
        shimmer.wrap(mongo.Collection.prototype, 'insert', wrapWithLabel('mongo-insert'));
        shimmer.wrap(mongo.Collection.prototype, 'save', wrapWithLabel('mongo-save'));
        shimmer.wrap(mongo.Collection.prototype, 'update', wrapWithLabel('mongo-update'));
        shimmer.wrap(mongo.Collection.prototype, 'findOne', wrapWithLabel('mongo-findOne'));
        shimmer.wrap(mongo.Collection.prototype, 'remove', wrapWithLabel('mongo-remove'));
        shimmer.wrap(mongo.Collection.prototype, 'count', wrapWithLabel('mongo-count'));
        shimmer.wrap(mongo.Collection.prototype, 'findAndModify', wrapWithLabel('mongo-findAndModify'));
        shimmer.wrap(mongo.Collection.prototype, 'findAndRemove', wrapWithLabel('mongo-findAndRemove'));
        shimmer.wrap(mongo.Collection.prototype, 'aggregate', wrapWithLabel('mongo-aggregate'));
        agent_.logger.info('Mongo: patched');
      },
      unpatch: function(mongo) {
        shimmer.unwrap(mongo.Collection.prototype, 'update');
        shimmer.unwrap(mongo.Collection.prototype, 'insert');
        shimmer.unwrap(mongo.Collection.prototype, 'update');
        shimmer.unwrap(mongo.Collection.prototype, 'remove');
        shimmer.unwrap(mongo.Collection.prototype, 'count');
        shimmer.unwrap(mongo.Collection.prototype, 'findAndModify');
        shimmer.unwrap(mongo.Collection.prototype, 'findAndRemove');
        shimmer.unwrap(mongo.Collection.prototype, 'aggregate');
        shimmer.unwrap(mongo.Collection.prototype, 'findOne');
        agent_.logger.info('Mongo: unpatched');
      }
    }
  };
};
