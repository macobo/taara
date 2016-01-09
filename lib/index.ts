/// <reference path="../typings/tsd.d.ts" />
import * as _ from "lodash";
import * as temp from "temp";
import {Promise, attempt} from "when";

import {
    DatabaseEngine,
    StorageEngine,
    StorageMetadata,
    SnapshotIdentifier
} from "./API";
import {arrayify, tryUnlink} from "./utils";

export {
    FileSystemEngine,
    S3StorageEngine
} from "./API";

// Should we leak any temporary files, delete them!
temp.track();

var tempFileOptions: temp.AffixOptions = {
    prefix: "taara-restore-"
};
var _storageEngine: StorageEngine = null;

export function setTempDir(dirPath: string) {
    tempFileOptions.dir = dirPath;
}


/** Configure a storage engine to store snapshots to. */
export function useStorageEngine(storageEngine: StorageEngine) {
    _storageEngine = storageEngine;
}

function getStorageEngine(): StorageEngine {
    if (_.isNull(_storageEngine)) {
        throw new Error("No taara storage engine configured. Please use `taara.useStorageEngine`.");
    }
    return _storageEngine;
}

/** Lists all snapshots stored in storageEngine to date. */
export function listSnapshots(): Promise<Array<SnapshotIdentifier>> {
    return attempt(getStorageEngine).then((engine) => engine.list());
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
    dbEngine: DatabaseEngine
): Promise<StorageMetadata> {
    const tableList = arrayify(tables);
    const identifier = new SnapshotIdentifier(tableList);
    const tempFilePath = temp.path(tempFileOptions);
    const storedData = {
        identifier: identifier,
        stats: {},
        metadata: userMetadata
    };

    // This writes the dump to two files in case of a on-disk store, can be optimized if needed.
    return dbEngine
        .dump(tableList, tempFilePath)
        .then(() => getStorageEngine().saveSnapshot(identifier, tempFilePath))
        .then(() => getStorageEngine().saveMetadata(storedData))
        .finally(() => tryUnlink(tempFilePath));
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
    dbEngine: DatabaseEngine
): Promise<StorageMetadata> {
    var storageMetadata;
    const dumpFileLocation = temp.path(tempFileOptions);
    return attempt(getStorageEngine)
        .then((storageEngine) => storageEngine.loadMetadata(identifier))
        .tap((metadata) => { storageMetadata = metadata; })
        .then((metadata) => getStorageEngine().loadSnapshot(metadata.identifier, dumpFileLocation))
        .then((path) => dbEngine.restore(path))
        .then(() => storageMetadata)
        .finally(() => tryUnlink(dumpFileLocation));
}

/**
 * Deletes an existing snapshot.
 *
 * @return a promise which will fail if storage engine is not configured or snapshot did not exist.
 */
export function deleteSnapshot(
    identifier: SnapshotIdentifier
): Promise<void> {
    return attempt(getStorageEngine)
        .tap((storageEngine) => storageEngine.deleteMetadata(identifier))
        .then((storageEngine) => storageEngine.deleteSnapshot(identifier));
}

export function getMetadata(
    identifier: SnapshotIdentifier
): Promise<StorageMetadata> {
    return attempt(getStorageEngine).then((engine) => engine.loadMetadata(identifier));
}
