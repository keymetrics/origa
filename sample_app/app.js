

var agent = require('..').start();
agent.getBus().on('transaction', function(transaction) {
  console.log(transaction);
});

var express = require('express');
var bodyParser = require('body-parser');
var mongoose = require('mongoose');
var Schema   = mongoose.Schema, ObjectID = Schema.ObjectId;
global._db = {};

(function bindSchema() {
  var PM2Schema = new Schema({
    ip    : { type : String, required : true },
    location       : Schema.Types.Mixed,
    created_at     : { type : Date, default : Date.now }
  });
  _db.dbPM2 = mongoose.model('PM2', PM2Schema);
})();

function connectToMongoDB(cb) {
  var mongoDB = mongoose.connection;

  mongoose.connect('mongodb://localhost/pm2Statsv2');

  //mongoose.set('debug', true);

  mongoDB.on('error', function cb() {
    console.log('Error when connecting to db ');
    process.exit(1);
  });

  mongoDB.once('open', function cb() {
    console.log('Successfully connected to database ');
  });

  return cb(null, mongoDB);
}

var app = express();
var server = require('http').Server(app);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded());

app.use('/', function(req, res) {
  var dt = new _db.dbPM2({
    ip : '129.123.123.13',
    location : { none : true }
  });

  dt.save(function(err, dt) {
    res.send(''+ dt);
  });
});

connectToMongoDB(function() {
  server.listen(8078, function() {
    console.log('Listening on port 8078');
  });
});
