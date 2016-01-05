/// <reference path="../typings/tsd.d.ts" />

import {spawn} from "child_process";
import * as fs from "fs";
import * as moment from "moment";
import * as path from "path";
import * as stream from "stream";
import VError = require("verror");
import * as when from "when";
import * as nodefn from "when/node";

import * as Utils from "./utils";

type Promise<T> = when.Promise<T>;

// An identifier consisting of a datetime and an tablename, uniquely identifying a single backup.
export class SnapshotIdentifier {
    static DATE_FORMAT = "YYYYMMDD-HHmmss"; // :TODO: time zone?

    constructor(public tablenames: Array<string>, public date: moment.Moment = moment()) {}

    filename(extension = ".snapshot") {
        const formatted = this.date.utc().format(SnapshotIdentifier.DATE_FORMAT);
        const names = this.tablenames.join("--");
        // :TODO: metadata should have a different filename?
        return `${names}.${formatted}${extension}`;
    }
}

export function getIdentifier(filename: string): SnapshotIdentifier {
    const [tablenames, datepart] = Utils.splitAtLast(filename, ".");
    const date = moment.utc(datepart, SnapshotIdentifier.DATE_FORMAT);
    return new SnapshotIdentifier(tablenames.split("--"), date);
}

export interface StorageMetadata {
    identifier: SnapshotIdentifier;
    stats: Object;
    metadata: Object; // user-provided metadata
}

export const StorageMetadata = {
    toJSON: (data: StorageMetadata): string => {
        const info = {
            identifier: data.identifier.filename(""),
            metadata: data.metadata,
            stats: data.stats
        };
        return JSON.stringify(info, null, 4);
    },

    fromJson: (json: string): StorageMetadata => {
        // :TODO: validation?
        const parsed = JSON.parse(json);
        return {
            identifier: getIdentifier(parsed.identifier),
            stats: parsed.stats,
            metadata: parsed.metadata
        };
    }
};

interface FileDescriptor {
    filename: string;
    extension: string;
}

export abstract class StorageEngine {
    abstract list(): Promise<Array<SnapshotIdentifier>>; // :TODO: Should this contain some extra info?
    abstract loadSnapshot(identifier: SnapshotIdentifier): Promise<stream.Readable>;
    abstract loadMetadata(identifier: SnapshotIdentifier): Promise<StorageMetadata>;
    abstract saveSnapshot(identifier: SnapshotIdentifier, snapshot: stream.Readable): Promise<any>; // Promise<stats>
    abstract saveMetadata(metadata: StorageMetadata): Promise<StorageMetadata>;
    abstract deleteSnapshot(identifier: SnapshotIdentifier): Promise<void>;
    abstract deleteMetadata(identifier: SnapshotIdentifier): Promise<void>;
}

abstract class FileBasedStorageEngine extends StorageEngine {
    protected abstract ls(path: string): Promise<Array<FileDescriptor>>;
    protected abstract read(path: string): Promise<stream.Readable>;
    protected abstract save(path: string, stream: stream.Readable): Promise<any>; // stats?
    protected abstract delete(path: string): Promise<void>;

    protected abstract rootPath(): string

    protected path(folder: string, identifier?: SnapshotIdentifier) {
        var mPath = path.join(this.rootPath(), folder);
        if (identifier) {
            mPath = path.join(mPath, identifier.filename());
        }
        return mPath;
    }

    list(): Promise<Array<SnapshotIdentifier>> {
        const fileList: Promise<Array<FileDescriptor>> = this.ls(this.path("metadata"));
        const getIdentifiers = (files: Array<FileDescriptor>) => files.map((f) => getIdentifier(f.filename));
        return fileList.then(getIdentifiers);
    }

    loadSnapshot(identifier: SnapshotIdentifier): Promise<stream.Readable> {
        return this.read(this.path("snapshot", identifier));
    }

    loadMetadata(identifier: SnapshotIdentifier): Promise<StorageMetadata> {
        const path = this.path("metadata", identifier);
        return this.read(path)
          .then(Utils.streamToString)
          .then(StorageMetadata.fromJson); // when.try?
    }

    saveSnapshot(identifier: SnapshotIdentifier, snapshot: stream.Readable): Promise<void> {
        return this.save(this.path("snapshot", identifier), snapshot);
    }

    saveMetadata(metadata: StorageMetadata): Promise<StorageMetadata> {
        const path = this.path("metadata", metadata.identifier);
        const json = StorageMetadata.toJSON(metadata);
        return this.save(path, Utils.makeReadStream(json)).then(() => metadata);
    }

    deleteSnapshot(identifier: SnapshotIdentifier) {
        return this.delete(this.path("snapshot", identifier));
    }

    deleteMetadata(identifier: SnapshotIdentifier) {
        return this.delete(this.path("metadata", identifier));
    }
}

export class FileSystemEngine extends FileBasedStorageEngine {
    constructor(private _rootPath) {
        super();
    }

    rootPath() { return this._rootPath; }

    protected delete(path: string): Promise<any> {
        return nodefn.call(fs.unlink, path);
    }

    protected ls(path: string): Promise<Array<FileDescriptor>> {
        const filesPromise = nodefn.call(fs.readdir, path);
        return filesPromise.then((files) => files.map((f) => {
            const [filename, extension] = Utils.splitAtLast(f, ".");
            return {
                filename: filename,
                extension: extension
            };
        }));
    }

    protected read(path: string): Promise<stream.Readable> {
        const reader = fs.createReadStream(path);
        return when(reader);
    }

    protected save(filepath: string, readStream: stream.Readable): Promise<void> {
        // Try to create the root directory if needed.
        try {
            fs.mkdirSync(path.dirname(filepath));
        } catch (error) {
            // Already there.
        }

        const deferred = when.defer<void>();
        const writeStream = fs.createWriteStream(filepath);
        readStream.pipe(writeStream);
        readStream.resume();
        writeStream.on("finish", deferred.resolve);
        writeStream.on("error", deferred.reject);
        readStream.on("error", deferred.reject);
        return deferred.promise;
    }
}

export abstract class DatabaseEngine {
    abstract dump(tables: Array<string>): Promise<stream.Readable>;
    abstract restore(snapshotPath: string): Promise<void>; // stats?
}

export interface PostgresAuthParams {
    database: string;
    user: string;
    host: string;
    port: number;
    password?: string;
}

export class PostgresEngine extends DatabaseEngine {
    constructor(private auth: PostgresAuthParams) {
        super();
    }

    authArgs(): [Array<string>, Object] {
        const result = Array<string>();
        var env: Object = {};
        result.push("-d", this.auth.database);
        result.push("-h", this.auth.host);
        result.push("-p", this.auth.port.toString());
        result.push("-U", this.auth.user);
        if (this.auth.password) {
            env = {PGPASSWORD: this.auth.password};
        }
        return [result, env];
    }

    dump(tables: Array<string>): Promise<stream.Readable> {
        var [params, env] = this.authArgs();
        params.push("-F", "custom");
        for (let table of tables) {
            params.push("-t", table);
        }
        // :TODO: shellescape
        const child = spawn("pg_dump", params, {env: env});

        const deferred = when.defer<stream.Readable>();
        child.on("error", (error) => {
            deferred.reject(new VError(error, "Could not spawn pg_dump."));
        });

        child.on("exit", (code, signal) => {
            if (code === 0) {
                deferred.resolve(child.stdout);
            } else {
                Utils.streamToString(child.stderr).then((log) => {
                    const table_string = tables.map((t) => `'${t}'`).join(", ");
                    const error = new Error(`Could not dump tables ${table_string}: ${log}`);
                    deferred.reject(error);
                });
            }
        });
        return deferred.promise;
    }

    restore(dumpPath: string): Promise<void> {
        var [params, env] = this.authArgs();
        params.push("-F", "custom");
        params.push("--exit-on-error");
        params.push("--single-transaction");
        params.push(dumpPath);

        const child = spawn("pg_restore", params, {env: env});
        const deferred = when.defer<void>();
        child.on("error", (error) => {
            deferred.reject(new VError(error, "Could not spawn pg_restore."));
        });

        child.on("exit", (code, signal) => {
            if (code === 0) {
                deferred.resolve();
            } else {
                Utils.streamToString(child.stderr).then((log) => {
                    const error = new Error(`Could not restore dump: ${log}`);
                    deferred.reject(error);
                });
            }
        });
        return deferred.promise;
    }
}
