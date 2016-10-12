# StackDriver Trace for Node.js

[![NPM Version][npm-image]][npm-url]
[![Build Status][travis-image]][travis-url]
[![Test Coverage][coveralls-image]][coveralls-url]
[![Dependency Status][david-image]][david-url]
[![devDependency Status][david-dev-image]][david-dev-url]

> *This module is experimental, and should be used by early adopters. This module uses APIs that may be undocumented and subject to change without notice.*

This module provides StackDriver Trace support for Node.js applications. [StackDriver Trace](https://cloud.google.com/cloud-trace/) is a feature of [Google Cloud Platform](https://cloud.google.com/) that collects latency data (traces) from your applications and displays it in near real-time in the [Google Cloud Console][cloud-console].

![StackDriver Trace Overview](doc/images/cloud-trace-overview-page.png)

## Prerequisites

1. Your application will need to be using Node.js version 0.12 or greater.
1. You will need a project in the [Google Developers Console][cloud-console]. Your application can run anywhere, but the trace data is associated with a particular project.
1. [Enable the Trace API](https://console.cloud.google.com/flows/enableapi?apiid=cloudtrace) for your project.

## Installation

1. Install with [`npm`](https://www.npmjs.com) or add to your [`package.json`](https://docs.npmjs.com/files/package.json#dependencies).

        npm install --save km-tracing

3. Include and start the library at the *as the very first action in your application*:

        require('km-tracing').start();


If you are running somewhere other than the Google Cloud Platform, see [running elsewhere](#running-elsewhere).

## Configuration

See [the default configuration](config.js) for a list of possible configuration options. These options can be passed to the agent through the object argument to the start command shown above:

        require('km-tracing').start({samplingRate: 500});

Alternatively, you can provide configuration through a config file. This can be useful if you want to load our module using `--require` on the command line instead of editing your main script. You can start by copying the default config file and modifying it to suit your needs.

## What gets traced

The trace agent can do automatic tracing of HTTP requests when using these frameworks:
* [express](https://www.npmjs.com/package/express) version 4
* [hapi](https://www.npmjs.com/package/hapi) versions 8 - 13
* [restify](https://www.npmjs.com/package/restify) versions 3 - 4 (experimental)

The agent will also automatic trace of the following kinds of RPCs:
* Outbound HTTP requests
* [MongoDB-core](https://www.npmjs.com/package/mongodb-core) version 1
* [Mongoose](https://www.npmjs.com/package/mongoose) version 4
* [Redis](https://www.npmjs.com/package/redis) versions 0.12 - 2
* [MySQL](https://www.npmjs.com/package/mysql) version ^2.9

You can use the [Custom Tracing API](#custom-tracing-api) to trace other processes in your application.

We are working on expanding the types of frameworks and services we can do automatic tracing for. We are also interested in hearing your feedback on what other frameworks, or versions, you would like to see supported. This would help us prioritize support going forward. If you want support for a particular framework or RPC, please file a bug or +1 an existing bug.

## Advanced trace configuration

The trace agent can be configured by passing a configurations object to the agent `start` method. This configuration option accepts all values in the [default configuration](config.js).

One configuration option of note is `enhancedDatabaseReporting`. Setting this option to `true` will cause database operations for redis and MongoDB to record query summaries and results as labels on reported trace spans.

## Disabling the trace agent

The trace agent can be turned off by specifying `enabled: false` in your configuration file.

## Trace batching and sampling

The aggregation of trace spans before publishing can be configured using the `flushDelaySeconds` and `bufferSize` [options](config.js). The spans recorded for each incoming requests are placed in a buffer after the request has completed. Spans will be published to the UI in batch when the spans from `bufferSize` requests have been queued in the buffer or after `flushDelaySeconds` have passed since the last publish, whichever comes first.

The trace configuration additionally exposes the `samplingRate` option which sets an upper bound on the number of traced requests captured per second. Some Google Cloud environments may override this sampling policy.

## Custom Tracing API

The custom tracing API can be used to add custom spans to trace. A *span* is a particular unit of work within a trace, such as an RPC request. Spans may be nested; the outermost span is called a *root span*, even if there are no nested child spans. Root spans typically correspond to incoming requests, while *child spans* typically correspond to outgoing requests, or other work that is triggered in response to incoming requests.

For any of the web frameworks listed above (`express`, `hapi`, and `restify`), a root span is automatically started whenever an incoming request is received (in other words, all middleware already runs within a root span). If you wish to record a span outside of any of these frameworks, any traced code must run within a root span that you create yourself.

The API is exposed by the `agent` returned by a call to `start`:

```javascript
  var agent = require('km-tracing').start();
```

For child spans, you can either use the `startSpan` and `endSpan` API, or use the `runInSpan` function that uses a callback-style. For root spans, you must use `runInRootSpan`.

### Start & end

To start a new child span, use `agent.startSpan`. Each span requires a name, and you can optionally specify labels.

```javascript
  var span = agent.startSpan('name', {label: 'value'});
```

Once your work is complete, you can end a child span with `agent.endSpan`. You can again optionally associate labels with the span:

```javascript
  agent.endSpan(span, {label2: 'value'});
```

### Run in span

`agent.runInSpan` takes a function to execute inside a custom child span with the given name. The function may be synchronous or asynchronous. If it is asynchronous, it must accept a 'endSpan' function as an argument that should be called once the asynchronous work has completed.

```javascript
  agent.runInSpan('name', {label: 'value'}, function() {
    doSynchronousWork();
  });

  agent.runInSpan('name', {label: 'value'}, function(endSpan) {
    doAsyncWork(function(result) {
      processResult(result);
      endSpan({label2: 'value'});
    });
  });
```

### Run in root span

`agent.runInRootSpan` behaves similarly to `agent.runInSpan`, except that the function is run within a root span.

```javascript
  agent.runInRootSpan('name', {label: 'value'}, function() {
    // You can record child spans in here
    doSynchronousWork();
  });
  agent.runInRootSpan('name', {label: 'value'}, function(endSpan) {
    // You can record child spans in here
    doAsyncWork(function(result) {
      processResult(result);
      endSpan({label2: 'value'});
    });
  });
```

### Changing trace properties

It is possible to rename and add labels to current trace. This can be use to give it a more meaningful name or add additional metata.

By default we use the name of the express (or hapi/restify) route as the transaction name, but it can be change using `agent.setTransactionName`:

```javascript
  agent.setTransactionName('new name');
```

You can add additional labels using `agent.addTransactionLabel`:

```javascript
  agent.addTransactionLabel('label', 'value');
```

## Contributing changes

* See [CONTRIBUTING.md](CONTRIBUTING.md)

## Licensing

* See [LICENSE](LICENSE)

[cloud-console]: https://console.cloud.google.com
[gcloud-sdk]: https://cloud.google.com/sdk/gcloud/
[app-default-credentials]: https://developers.google.com/identity/protocols/application-default-credentials
[service-account]: https://console.developers.google.com/apis/credentials/serviceaccountkey
[npm-image]: https://badge.fury.io/js/%40google%2Fcloud-trace.svg
[npm-url]: https://npmjs.org/package/@google/cloud-trace
[travis-image]: https://travis-ci.org/GoogleCloudPlatform/cloud-trace-nodejs.svg?branch=master
[travis-url]: https://travis-ci.org/GoogleCloudPlatform/cloud-trace-nodejs
[coveralls-image]: https://coveralls.io/repos/GoogleCloudPlatform/cloud-trace-nodejs/badge.svg?branch=master&service=github
[coveralls-url]: https://coveralls.io/github/GoogleCloudPlatform/cloud-trace-nodejs?branch=master
[david-image]: https://david-dm.org/GoogleCloudPlatform/cloud-trace-nodejs.svg
[david-url]: https://david-dm.org/GoogleCloudPlatform/cloud-trace-nodejs
[david-dev-image]: https://david-dm.org/GoogleCloudPlatform/cloud-trace-nodejs/dev-status.svg
[david-dev-url]: https://david-dm.org/GoogleCloudPlatform/cloud-trace-nodejs#info=devDependencies