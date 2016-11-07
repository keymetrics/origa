
var vxx = require('..').start();

var mongoose = require('../test/hooks/fixtures/mongoose4');
var Schema = mongoose.Schema;
var assert = require('assert');

var simpleSchema = new Schema({
  f1: String,
  f2: Boolean,
  f3: Number
});

var Simple = mongoose.model('Simple', simpleSchema);

describe('API', function() {
  beforeEach(function(done) {
    var sim = new Simple({
      f1: 'sim',
      f2: true,
      f3: 42
    });
    mongoose.connect('mongodb://localhost:27017/testdb', function(err) {
      sim.save(function(err) {
        assert(!err);
        done();
      });
    });
  });

  afterEach(function(done) {
    mongoose.connection.db.dropDatabase(function(err) {
      assert(!err);
      mongoose.connection.close(function(err) {
        assert(!err);
        done();
      });
    });
  });

  function runInTransaction(fn) {
    vxx.getCls().getNamespace().run(function() {
      var spanData = vxx.getAgent().createRootSpanData('outer');
      fn(function() {
        spanData.close();
      });
    });
  }

  it('should bus count 2 transactions', function(done) {
    var data = new Simple({
      f1: 'val',
      f2: false,
      f3: 1729
    });

    var data2 = new Simple({
      f1: 'asdval',
      f2: true,
      f3: 1729
    });

    vxx.getBus().on('transaction', function(transaction) {
      console.dir(transaction);
      done();
    });

    vxx.runInRootSpan('test', {label : 'fake-query' }, function(endTransaction) {
      data.save(function(err) {
        assert(!err);
        setTimeout(function() {
          setTimeout(function() {
            data2.save(function(err) {
              endTransaction();
            });
          }, 3);
        }, 2);
      });
    });

  });
});
