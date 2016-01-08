# taara

[![Build Status](https://img.shields.io/travis/macobo/taara/master.svg?style=flat-square)](https://travis-ci.org/macobo/taara)

A PostgreSQL table snapshot tool for node.js.

## Installation

Install it using [npm](http://github.com/isaacs/npm):

    $ npm install taara

Or get it directly from:
http://github.com/macobo/taara

## Usage

To use the library, you need to configure to use storage engine. At this time, the library supports on-disk backups as well as S3 Backups.

### Using S3 storage

```javascript
var taara = require('taara');

var storageEngine = new taara.S3StorageEngine('my-bucket', s3AuthParams);
taara.useStorageEngine(storageEngine);
```

`s3AuthParams` - See AWS SDK documentation for available options which are passed to new AWS.S3(): http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Config.html#constructor-property

### Using on-disk storage

```javascript
var storageEngine = new taara.FileSystemEngine('/path/to/backup/location');
taara.useStorageEngine(storageEngine);
```

### Storing a snapshot of a table.

```javascript
var pgAuth = {
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "postgres",
    password: "my-password"
};

// Stored along with the snapshot, can be later used during the restore process
var userMetadata = { my: "value" };

taara.storeSnapshot('events', userMetadata, pgAuth).then(function(storageMetadata) {
    var identifier = storageMetadata.identifier;
    console.log("Stored snapshot of", identifier.tablenames, "at", identifier.date);
});
```

The snapshot will be stored at `snapshot/events_20160112-235323.snapshot` (depending
on date) and snapshot at `metadata/events_20160112-235323.metadata`.

### Listing snapshots and fetching stored metadata.

```javascript
taara
    .listSnapshots()
    // Print out list of identifiers
    .tap(function(identifiers) {
        identifiers.forEach(function(identifier) {
            console.log("Snapshot of", identifier.tablenames, "was taken at", identifier.date);
        });
    })
    // And fetch metadata for one of the backups.
    .then(function(identifiers) {
        return taara.getMetadata(identifiers[0]));
    })
    .then(function(storageMetadata) {
        console.log("identifier:", storageMetadata.identifier);
        console.log("stats:", storageMetadata.stats);
        console.log("user-provided metadata:", storageMetadata.metadata);
    });
```

### Restoring a snapshot

```javascript
taara.restoreSnapshot(identifier, pgAuth)
    .then(function(storageMetadata) {
        console.log("Restored snapshot. identifier:", storageMetadata.identifier);
    });
```


## API Documentation



## Motivation

At [Heap Analytics](heapanalytics.com) we use sharding, PostgreSQL and sharding extensively to store
with our user data. As each shard is replicated, even if we lose a single database instance,
we won't lose any data. However, if more databases than the replication factor should die,
we'd need to deal with full-blown database restores simply to get at a few shards out of
tens of thousands - something which is costly in terms of storage as well as time.

This library is an attempt to deal better with that problem - instead of making full-blown
database backups, we store snapshots of tables on S3 with some Kafka metadata. Should
shards "disappear" we can use the snapshot to restore the shards to a good state and replay
all new events that that happened since using Kafka.

## Contributing

To setup, you need to install a few dependencies:

- `npm install -g typescript gulp`
- `npm install`

To compile and to do a test run:

- `docker-compose up -d` - starts a database and [fake_s3](https://github.com/jubos/fake-s3) instance. [1]
- `gulp test`

[1]: More on Docker Compose [here](https://docs.docker.com/compose/).