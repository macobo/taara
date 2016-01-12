/// <reference path="../typings/tsd.d.ts" />

import * as AWS from "aws-sdk";
import {spawn} from "child_process";
import * as fs from "fs";
import * as moment from "moment";
import * as path from "path";
import * as s3 from "s3";
import * as stream from "stream";
import VError = require("verror");
import * as when from "when";
import * as nodefn from "when/node";

import * as Utils from "./utils";

export type Promise<T> = when.Promise<T>;

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

export interface FileDescriptor {
    filename: string;
    extension: string;
}

export abstract class StorageEngine {
    abstract list(): Promise<Array<SnapshotIdentifier>>; // :TODO: Should this contain some extra info?
    abstract loadSnapshot(identifier: SnapshotIdentifier, outpath: string): Promise<string>;
    abstract loadMetadata(identifier: SnapshotIdentifier): Promise<StorageMetadata>;
    abstract saveSnapshot(identifier: SnapshotIdentifier, snapshotPath: string): Promise<any>; // Promise<stats>
    abstract saveMetadata(metadata: StorageMetadata): Promise<StorageMetadata>;
    abstract deleteSnapshot(identifier: SnapshotIdentifier): Promise<void>;
    abstract deleteMetadata(identifier: SnapshotIdentifier): Promise<void>;
}

export abstract class FileBasedStorageEngine extends StorageEngine {
    protected abstract ls(path: string): Promise<Array<FileDescriptor>>;
    protected abstract readContents(path: string): Promise<string>;
    /** Reads file from _source_ on storage and returns a promise with local destination. */
    protected abstract copyFileToLocalDisk(source: string, potentialDestination: string): Promise<string>;
    protected abstract uploadData(path: string, data: string): Promise<void>;
    protected abstract delete(path: string): Promise<void>;

    protected uploadFile(destination: string, source: string): Promise<void> {
        return this.readContents(source).then((data) => this.uploadData(destination, data));
    }

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
        return fileList.then((files) => files.map((f) => getIdentifier(f.filename)));
    }

    loadSnapshot(identifier: SnapshotIdentifier, outfile: string): Promise<string> {
        return this.copyFileToLocalDisk(this.path("snapshot", identifier), outfile);
    }

    loadMetadata(identifier: SnapshotIdentifier): Promise<StorageMetadata> {
        const path = this.path("metadata", identifier);
        return this.readContents(path)
          .then(StorageMetadata.fromJson);
    }

    saveSnapshot(identifier: SnapshotIdentifier, snapshotPath: string): Promise<void> {
        return this.uploadFile(this.path("snapshot", identifier), snapshotPath);
    }

    saveMetadata(metadata: StorageMetadata): Promise<StorageMetadata> {
        const path = this.path("metadata", metadata.identifier);
        const json = StorageMetadata.toJSON(metadata);
        return this.uploadData(path, json).then(() => metadata);
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

    private createdir(filepath: string) {
        // Try to create the root directory if needed.
        try {
            fs.mkdirSync(path.dirname(filepath));
        } catch (error) {
            // Already there.
        }
    }

    protected delete(path: string): Promise<any> {
        return nodefn.call(fs.unlink, path);
    }

    protected ls(path: string): Promise<Array<FileDescriptor>> {
        const filesPromise = nodefn.call(fs.readdir, path);
        const filterFiles = (files) => files.map((f) => {
            const [filename, extension] = Utils.splitAtLast(f, ".");
            return {
                filename: filename,
                extension: extension
            };
        // Filter out all subdirs.
        }).filter(({extension}) => extension !== "");

        return filesPromise.then(filterFiles);
    }

    protected readContents(path: string): Promise<string> {
        return when.attempt(() => fs.readFileSync(path, "utf-8"));
    }

    protected copyFileToLocalDisk(source: string, potentialDestination: string): Promise<string> {
        return when(source);
    }

    protected uploadData(filepath: string, contents: string): Promise<any> {
        this.createdir(filepath);
        return nodefn.call(fs.writeFile, filepath, contents);
    }

    protected uploadFile(destination: string, source: string): Promise<any> {
        this.createdir(destination);
        const readStream = fs.createReadStream(source);
        const writeStream = fs.createWriteStream(destination);
        readStream.pipe(writeStream);

        const deferred = when.defer<void>();
        writeStream.on("finish", deferred.resolve);
        writeStream.on("error", deferred.reject);
        readStream.on("error", deferred.reject);
        return deferred.promise;
    }
}

function emitterToPromise(emitter: s3.ProgressEmitter): Promise<void> {
    const deferred = when.defer<void>();
    emitter.on("error", deferred.reject);
    emitter.on("end", deferred.resolve);
    return deferred.promise;
}

export class S3StorageEngine extends FileBasedStorageEngine {
    private s3: s3.Client;
    public aws_s3: AWS.S3;

    constructor(private bucket, s3Options: any, private _rootPath = "") {
        super();
        this.aws_s3 = new AWS.S3(s3Options);
        this.s3 = s3.createClient({s3Client: this.aws_s3});
    }

    rootPath() { return this._rootPath; }

    protected ls(keyPrefix: string): Promise<Array<FileDescriptor>> {
        if (keyPrefix.length && keyPrefix.slice(-1) !== "/") {
            keyPrefix += "/";
        }
        const emitter = this.s3.listObjects({
            s3Params: {
                Bucket: this.bucket,
                Prefix: keyPrefix,
                Delimiter: "/"
            }
        });
        const deferred = when.defer<Array<FileDescriptor>>();
        const result: Array<FileDescriptor> = [];
        emitter.on("error", deferred.reject);
        emitter.on("end", () => deferred.resolve(result));
        emitter.on("data", (data) => {
            const list = <Array<{Key: string}>>data.Contents;
            list.forEach(({Key}) => {
                const basename = path.basename(Key);
                const [filename, extension] = Utils.splitAtLast(basename, ".");
                result.push({ filename: filename, extension: extension });
            });
        });
        return deferred.promise;
    }

    protected delete(path: string): Promise<void> {
        const params = {
            Bucket: this.bucket,
            Key: path
        };
        const deleteFn = (callback) => this.aws_s3.deleteObject(params, callback);
        return nodefn.call(deleteFn).then(() => undefined);
    }

    protected readContents(path: string): Promise<string> {
        // Stub typing because no good types available.
        const request = <any>this.aws_s3.getObject({Bucket: this.bucket, Key: path});
        return Utils.streamToString(<stream.Readable>request.createReadStream());
    }

    protected copyFileToLocalDisk(source: string, localPath: string): Promise<string> {
        const emitter = this.s3.downloadFile({
            localFile: localPath,
            s3Params: {
                Bucket: this.bucket,
                Key: source
            }
        });
        return emitterToPromise(emitter).then(() => localPath);
    }

    private saveStream(key: string, stream: stream.Readable): Promise<void> {
        const params = {
            Bucket: this.bucket,
            Key: key,
            Body: stream
        };
        // :TODO: figure out how to bind this without losing typing.
        const upload = (callback) => this.aws_s3.upload(params, callback);
        return nodefn.call(upload).then(() => undefined);
    }

    protected uploadData(key: string, dataPath: string): Promise<void> {
        const stream = Utils.makeReadStream(dataPath);
        return this.saveStream(key, stream);
    }

    protected uploadFile(key: string, localPath: string): Promise<void> {
        const stream = fs.createReadStream(localPath);
        return this.saveStream(key, stream);
    }
}

export interface PostgresAuthParams {
    database: string;
    user: string;
    host: string;
    port: number;
    password?: string;
}

export class PostgresEngine {
    static authArgs(auth: PostgresAuthParams): [Array<string>, Object] {
        const result = Array<string>();
        var env: Object = {};
        result.push("-d", auth.database);
        result.push("-h", auth.host);
        result.push("-p", auth.port.toString());
        result.push("-U", auth.user);
        if (auth.password) {
            env = {PGPASSWORD: auth.password};
        }
        return [result, env];
    }

    static dump(auth: PostgresAuthParams, tables: Array<string>, outpath: string): Promise<void> {
        var [params, env] = PostgresEngine.authArgs(auth);
        params.push("-F", "custom");
        for (let table of tables) {
            params.push("-t", table);
        }
        params.push("-f", outpath);
        // :TODO: shellescape
        const child = spawn("pg_dump", params, {env: env});

        const deferred = when.defer<void>();
        child.on("error", (error) => {
            deferred.reject(new VError(error, "Could not spawn pg_dump."));
        });

        child.on("exit", (code, signal) => {
            if (code === 0) {
                deferred.resolve();
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

    static restore(auth: PostgresAuthParams, dumpPath: string): Promise<void> {
        var [params, env] = PostgresEngine.authArgs(auth);
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
