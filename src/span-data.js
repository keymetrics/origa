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

var TraceSpan = require('./trace-span.js');
var TraceLabels = require('./trace-labels.js');

// Auto-incrementing integer
var uid = 1;

/**
 * Creates a trace context object.
 * @param {Trace} trace The object holding the spans comprising this trace.
 * @param {string} name The name of the span.
 * @param {number} parentSpanId The id of the parent span, 0 for root spans.
 * @param {boolean} isRoot Whether this is a root span.
 * @param {number} skipFrames the number of frames to remove from the top of the stack.
 * @constructor
 */
function SpanData(agent, trace, name, parentSpanId, isRoot, skipFrames) {
  var self = this;
  var spanId = uid++;
  this.agent = agent;
  this.span = new TraceSpan(name, spanId, parentSpanId);
  this.trace = trace;
  this.isRoot = isRoot;
  trace.spans.push(this.span);

  if (agent.config().stackTraceLimit > 0) {

    var origLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = agent.config().stackTraceLimit + skipFrames;
    var frames = agent.stackman(new Error(), function (stack) {
      var finalFrames = [];

      // parse each frame to retrieve only important information
      stack.frames.forEach(function (frame) {
        if (!frame.isApp()) return ;

        var functionName = frame.getFunctionName();
        var methodName = frame.getMethodName();
        var name = (methodName && functionName) ?
          functionName + ' [as ' + methodName + ']' :
          functionName || methodName || '<anonymous function>';

        // avoid frames from tracing module
        if (frame.getFileName().indexOf('vxx') > -1)
          return ;
        finalFrames.push(new StackFrame(null, name, frame.getFileName(),
          frame.getLineNumber(), frame.getColumnNumber(), frame.context));
      })
      // set it as labels after parsing
      self.span.setLabel(TraceLabels.STACK_TRACE_DETAILS_KEY, JSON.stringify(finalFrames));
    });
    Error.stackTraceLimit = origLimit;
  }
}

/**
 * Creates a child span of this span.
 * @param name The name of the child span.
 * @param {number} skipFrames The number of caller frames to eliminate from
 *                            stack traces.
 * @returns {SpanData} The new child trace span data.
 */
SpanData.prototype.createChildSpanData = function(name, skipFrames) {
  return new SpanData(this.agent, this.trace, name, this.span.spanId, false,
      skipFrames + 1);
};

SpanData.prototype.addLabel = function(key, value) {
  this.span.setLabel(key, value);
};

/**
 * Closes the span and queues it for publishing if it is a root.
 */
SpanData.prototype.close = function() {
  this.span.close();
  if (this.isRoot) {
    this.agent.logger.info('Writing root span');
    this.agent.traceWriter.writeSpan(this);
  }
};

/**
 * Trace API expects stack frames to be a JSON string with the following
 * structure:
 * STACK_TRACE := { "stack_frame" : [ FRAMES ] }
 * FRAMES := { "class_name" : CLASS_NAME, "file_name" : FILE_NAME,
 *             "line_number" : LINE_NUMBER, "method_name" : METHOD_NAME }*
 *
 * While the API doesn't expect a columnNumber at this point, it does accept,
 * and ignore it.
 *
 * @param {string|undefined} className
 * @param {string|undefined} methodName
 * @param {string|undefined} fileName
 * @param {number|undefined} lineNumber
 * @param {number|undefined} columnNumber
 * @constructor @private
 */
function StackFrame(className, methodName, fileName, lineNumber, columnNumber, context, type) {
  if (className) {
    this.class_name = className;
  }
  if (methodName) {
    this.method_name = methodName;
  }
  if (fileName) {
    this.file_name = fileName;
  }
  if (typeof lineNumber === 'number') {
    this.line_number = lineNumber;
  }
  if (typeof columnNumber === 'number') {
    this.column_number = columnNumber;
  }
  if (typeof(context) === 'object') {
    this.context = context;
  }
}

SpanData.nullSpan = {
  createChildSpanData: function() { return SpanData.nullSpan; },
  addLabel: function() {},
  close: function() {}
};

/**
 * Export SpanData.
 */
module.exports = SpanData;
