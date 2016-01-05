/// <reference path="../typings/tsd.d.ts" />
import * as fs from "fs";
import * as temp from "temp";
import {Promise} from "when";
import * as nodefn from "when/node";

import * as API from "./API";
import {arrayify, streamToFile} from "./utils";

export function listSnapshots(storageEngine: API.StorageEngine): Promise<Array<API.SnapshotIdentifier>> {
    return storageEngine.list();
}

export function storeSnapshot(
    tables: string|Array<string>,
    userMetadata: Object,
    storageEngine: API.StorageEngine,
    dbEngine: API.DatabaseEngine
): Promise<API.StorageMetadata> {
    const tableList = arrayify(tables);
    const identifier = new API.SnapshotIdentifier(tableList);
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

export function restoreSnapshot(
    identifier: API.SnapshotIdentifier,
    storageEngine: API.StorageEngine,
    dbEngine: API.DatabaseEngine
): Promise<API.StorageMetadata> {
    var storageMetadata;
    const dumpFileLocation = temp.path("taara-restore-");
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
    identifier: API.SnapshotIdentifier,
    storageEngine: API.StorageEngine
): Promise<void> {
    return storageEngine
        .deleteMetadata(identifier)
        .then(() => storageEngine.deleteSnapshot(identifier));
}
