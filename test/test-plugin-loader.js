/**
 * Copyright 2017 Google Inc. All Rights Reserved.
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

var shimmer = require('shimmer');
var Module = require('module');
var assert = require('assert');
var proxyquire = require('proxyquire');
var path = require('path');

// Save logs because in some cases we want to verify that something was logged.
var logs = {
  error: '',
  warn: '',
  info: ''
};

// Facilitates loading "fake" modules upon calling require().
var fakeModules = {};

// Adds module moduleName to the set of fake modules, using mock as the object
// being "exported" by this module. In addition, providing version makes it
// accessible by calling findModuleVersion.
function addModuleMock(moduleName, version, mock) {
  fakeModules[moduleName.replace('/', path.sep)] = {
    exports: mock,
    version: version
  };
}

// This function creates an object with just enough properties to appear to the
// plugin loader as the trace agent. It accepts the list of plugins that the
// plugin loader reads.
function createFakeAgent(plugins) {
  function writeToLog(log, data) {
    logs[log] += data + '\n';
  }
  return {
    logger: {
      error: writeToLog.bind(null, 'error'),
      warn: writeToLog.bind(null, 'warn'),
      info: writeToLog.bind(null, 'info')
    },
    config: function() {
      return { plugins: plugins };
    }
  };
}

describe('Trace Plugin Loader', function() {
  var pluginLoader;

  before(function() {
    // Wrap Module._load so that it loads from our fake module set rather than the
    // real thing
    shimmer.wrap(Module, '_load', function(originalModuleLoad) {
      return function wrappedModuleLoad(modulePath) {
        if (fakeModules[modulePath.replace('/', path.sep)]) {
          return fakeModules[modulePath.replace('/', path.sep)].exports;
        }
        return originalModuleLoad.apply(this, arguments);
      };
    });

    // proxyquire the plugin loader with stubbed module utility methods
    pluginLoader = proxyquire('../src/trace-plugin-loader.js', {
      './util.js': {
        findModulePath: function(request) {
          return request.replace('/', path.sep);
        },
        findModuleVersion: function(modulePath) {
          return fakeModules[modulePath].version;
        }
      }
    });
  });

  after(function() {
    shimmer.unwrap(Module, '_load');
  });

  afterEach(function() {
    pluginLoader.deactivate();
    logs.error = '';
    logs.warn = '';
    logs.info = '';
    fakeModules = {};
  });

  /**
   * Loads two modules (one of them twice), and makes sure that plugins are
   * applied correctly.
   */
  it('loads plugins no more than once', function() {
    var patched = [];
    addModuleMock('module-a', '1.0.0', {});
    addModuleMock('module-b', '1.0.0', {});
    addModuleMock('module-a-plugin', '', [
      { patch: function() { patched.push('a'); } }
    ]);
    addModuleMock('module-b-plugin', '', [
      { file: '', patch: function() { patched.push('b'); } }
    ]);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-a': 'module-a-plugin',
      'module-b': 'module-b-plugin'
    }));
    assert.deepEqual(patched, [],
      'No patches are initially loaded');
    require('module-a');
    assert.deepEqual(patched, ['a'],
      'Patches are applied when the relevant patch is loaded');
    assert(logs.info.indexOf('Patching module-a at version 1.0.0') !== -1,
      'Info log is emitted when a module if patched');
    require('module-a');
    assert.deepEqual(patched, ['a'],
      'Patches aren\'t applied twice');
    require('module-b');
    assert.deepEqual(patched, ['a', 'b'],
      'Multiple plugins can be loaded, and file can be set to an empty string');
  });

  /**
   * Loads two plugins that each monkeypatch modules, and checks that they are
   * actually monkeypatched.
   */
  it('applies patches', function() {
    addModuleMock('module-c', '1.0.0', {
      getStatus: function() { return 'not wrapped'; }
    });
    addModuleMock('module-d', '1.0.0', {
      getStatus: function() { return 'not wrapped'; }
    });
    addModuleMock('module-c-plugin', '', [
      {
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'getStatus', function() {
            return function() { return 'wrapped'; };
          });
        }
      }
    ]);
    assert.strictEqual(require('module-c').getStatus(), 'not wrapped',
      'Plugin loader shouldn\'t affect module before plugin is loaded');
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-c': 'module-c-plugin'
    }));
    assert.strictEqual(require('module-c').getStatus(), 'wrapped',
      'Plugin patch() method is called the right arguments');
    assert.strictEqual(require('module-d').getStatus(), 'not wrapped',
      'Modules for which there aren\'t plugins won\'t be patched');
  });

  /**
   * Loads one module to check that plugin patches that aren't compatible don't
   * get applied. Then, loads another module with no compatible patches to check
   * that nothing gets patched at all.
   */
  it('respects patch set semver conditions', function() {
    var patched = [];
    addModuleMock('module-e', '1.0.0', {});
    addModuleMock('module-f', '2.0.0', {});
    addModuleMock('module-e-plugin', '', [
      { versions: '1.x', patch: function() { patched.push('e-1.x'); } },
      { versions: '2.x', patch: function() { patched.push('e-2.x'); } }
    ]);
    addModuleMock('module-f-plugin', '', [
      { versions: '1.x', patch: function() { patched.push('f-1.x'); } }
    ]);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-e': 'module-e-plugin',
      'module-f': 'module-f-plugin'
    }));
    assert.deepEqual(patched, []);
    require('module-e');
    assert.deepEqual(patched, ['e-1.x'],
      'Only patches with a correct semver condition are loaded');
    require('module-f');
    assert.deepEqual(patched, ['e-1.x'],
      'No patches are loaded if the module version isn\'t supported at all');
    assert(logs.warn.indexOf('module-f: version 2.0.0 not supported') !== -1,
      'A warning is printed if the module version isn\'t supported at all');
  });

  /**
   * Loads a module with internal exports and patches them, and then makes sure
   * that they are actually patched.
   */
  it('patches internal files in modules', function() {
    addModuleMock('module-g', '1.0.0', {
      createSentence: function() {
        return require('module-g/subject').get() + ' ' +
          require('module-g/predicate').get() + '.';
      }
    });
    addModuleMock('module-g/subject', '', {
      get: function() {
        return 'bad tests';
      }
    });
    addModuleMock('module-g/predicate', '', {
      get: function() {
        return 'don\'t make sense';
      }
    });
    addModuleMock('module-g-plugin', '', [
      {
        file: 'subject',
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'get', function() {
            return function() {
              return 'good tests';
            };
          });
        }
      },
      {
        file: 'predicate',
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'get', function() {
            return function() {
              return 'make sense';
            };
          });
        }
      }
    ]);
    assert.strictEqual(require('module-g').createSentence(),
      'bad tests don\'t make sense.');
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-g': 'module-g-plugin'
    }));
    assert.strictEqual(require('module-g').createSentence(),
      'good tests make sense.',
      'Files internal to a module are patched');
  });

  /**
   * Uses module interception to completely replace a module export
   */
  it('can intercept modules', function() {
    addModuleMock('module-i', '1.0.0', function() { return 1; });
    addModuleMock('module-i-plugin', '', [{
      intercept: function(originalModule, api) {
        return function() { return originalModule() + 1; };
      }
    }]);
    assert.strictEqual(require('module-i')(), 1);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-i': 'module-i-plugin'
    }));
    assert.strictEqual(require('module-i')(), 2,
      'Module can be intercepted');
  });

  /**
   * Patches a module, then immediately unpatches it, then patches it again to
   * show that patching isn't irreversible (and neither is unpatching)
   */
  it('can unpatch', function() {
    addModuleMock('module-j', '1.0.0', {
      getPatchMode: function() { return 'none'; }
    });
    addModuleMock('module-j-plugin', '', [{
      patch: function(originalModule, api) {
        shimmer.wrap(originalModule, 'getPatchMode', function() {
          return function() { return 'patch'; };
        });
      },
      unpatch: function(originalModule) {
        shimmer.unwrap(originalModule, 'getPatchMode');
      }
    }]);
    assert.strictEqual(require('module-j').getPatchMode(), 'none');
    pluginLoader.activate(createFakeAgent({
      'module-j': 'module-j-plugin'
    }));
    assert.strictEqual(require('module-j').getPatchMode(), 'patch');
    pluginLoader.deactivate();
    assert.strictEqual(require('module-j').getPatchMode(), 'none',
      'Module gets unpatched');
    pluginLoader.activate(createFakeAgent({
      'module-j': 'module-j-plugin'
    }));
    assert.strictEqual(require('module-j').getPatchMode(), 'patch',
      'Patches still work after unpatching');
  });

  it('doesn\'t load plugins with falsey paths', function() {
    var moduleExports = {};
    addModuleMock('module-k', '1.0.0', moduleExports);
    assert(require('module-k') === moduleExports);
    pluginLoader.activate(createFakeAgent({ 'module-k': '' }));
    assert(require('module-k') === moduleExports,
      'Module exports the same thing as before');
  });

  /**
   * Loads plugins with bad patches and ensures that they throw/log
   */
  it('throws and warns for serious problems', function() {
    addModuleMock('module-k', '1.0.0', {});
    addModuleMock('module-k-plugin-noop', '', [{}]);
    addModuleMock('module-k-plugin-pi', '', [{
      patch: function() {},
      intercept: function() { return 'intercepted'; }
    }]);
    addModuleMock('module-k-plugin-upi', '', [{
      unpatch: function() {},
      intercept: function() { return 'intercepted'; }
    }]);
    addModuleMock('module-k-plugin-noup', '', [{
      patch: function(m) { m.patched = true; }
    }]);
    
    pluginLoader.activate(createFakeAgent({
      'module-k': 'module-k-plugin-noop'
    }));
    assert.throws(function() { require('module-k'); },
      'Loading patch object with no patch/intercept function throws');
    pluginLoader.deactivate();

    pluginLoader.activate(createFakeAgent({
      'module-k': 'module-k-plugin-pi'
    }));
    assert.throws(function() { require('module-k'); },
      'Loading patch object with both patch/intercept functions throws');
    pluginLoader.deactivate();

    pluginLoader.activate(createFakeAgent({
      'module-k': 'module-k-plugin-upi'
    }));
    assert.strictEqual(require('module-k'), 'intercepted');
    assert(logs.warn.indexOf('unpatch is not compatible with intercept') !== -1,
      'Warn when plugin has both unpatch and intercept');
    pluginLoader.deactivate();

    pluginLoader.activate(createFakeAgent({
      'module-k': 'module-k-plugin-noup'
    }));
    assert.ok(require('module-k').patched);
    assert(logs.warn.indexOf('without accompanying unpatch') !== -1,
      'Warn when plugin has both patch and no unpatch');
  });
});
