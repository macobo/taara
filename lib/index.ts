/// <reference path="../typings/tsd.d.ts" />
import * as fs from "fs";
import * as temp from "temp";
import {Promise} from "when";
import * as nodefn from "when/node";

import {
    DatabaseEngine,
    StorageEngine,
    StorageMetadata,
    SnapshotIdentifier
} from "./API";
import {arrayify, streamToFile} from "./utils";

var tempFileOptions: temp.AffixOptions = {
    prefix: "taara-restore-"
};

export function setTempDir(dirPath: string) {
    tempFileOptions.dir = dirPath;
}

/** Lists all snapshots stored in storageEngine to date. */
export function listSnapshots(storageEngine: StorageEngine): Promise<Array<SnapshotIdentifier>> {
    return storageEngine.list();
}

/**
 * Takes a snapshot of tables from database and stores it on S3.
 *
 * @param userMetadata object to be stored with the snapshot.
 * @return a promise for an object with the identifier, metadata and stats for
 * this snapshot.
 */
export function storeSnapshot(
    tables: string|Array<string>,
    userMetadata: Object,
    storageEngine: StorageEngine,
    dbEngine: DatabaseEngine
): Promise<StorageMetadata> {
    const tableList = arrayify(tables);
    const identifier = new SnapshotIdentifier(tableList);
    const storedData = {
        identifier: identifier,
        stats: {},
        metadata: userMetadata
    };

    return dbEngine
        .dump(tableList)
        .then((stream) => storageEngine.saveSnapshot(identifier, stream))
        .then(() => storageEngine.saveMetadata(storedData));
}

/**
 * Given an identifier (from `taara.listSnapshots`) this will restore the table.
 * Uses temporary files - to configure what directory to use, see `taara.setTempDir`.
 *
 * @return a promise for an object with the identifier, metadata and stats for
 * this snapshot.
 */
export function restoreSnapshot(
    identifier: SnapshotIdentifier,
    storageEngine: StorageEngine,
    dbEngine: DatabaseEngine
): Promise<StorageMetadata> {
    var storageMetadata;
    const dumpFileLocation = temp.path(tempFileOptions);
    return storageEngine
        .loadMetadata(identifier)
        .tap((metadata) => { storageMetadata = metadata; })
        .then((metadata) => storageEngine.loadSnapshot(metadata.identifier))
        .then((stream) => streamToFile(stream, dumpFileLocation))
        .then(() => dbEngine.restore(dumpFileLocation))
        .then(() => storageMetadata)
        .finally(() => nodefn.call(fs.unlink, dumpFileLocation));
}

export function deleteSnapshot(
    identifier: SnapshotIdentifier,
    storageEngine: StorageEngine
): Promise<void> {
    return storageEngine
        .deleteMetadata(identifier)
        .then(() => storageEngine.deleteSnapshot(identifier));
}
