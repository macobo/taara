/// <reference path="../typings/tsd.d.ts" />
import * as fs from "fs";
import * as temp from "temp";
import * as stream from "stream";
import {Promise, defer} from "when";
import * as nodefn from "when/node";

export function arrayify<T>(elem: T|Array<T>): Array<T> {
    if (elem instanceof Array) {
        return elem;
    }
    return [<T>elem];
}

export function splitAtLast(text: string, sep: string) {
    const index = text.lastIndexOf(sep);
    return [text.substr(0, index), text.substr(index + 1)];
}

export function streamToString(stream: stream.Readable): Promise<string> {
    const deferred = defer<string>();
    const buffer = [];

    stream.on("data", (chunk) => buffer.push(chunk));
    stream.on("end", () => deferred.resolve(buffer.join("")));
    stream.on("error", deferred.reject);
    return deferred.promise;
}

export function makeReadStream(s: string): stream.Readable {
    const readStream = new stream.Readable();
    /* tslint:disable:no-empty */
    readStream._read = () => {};
    /* tslint:enable:no-empty */
    readStream.push(s);
    readStream.push(null);
    return readStream;
}

export function streamToFile(inStream: stream.Readable, path?: string): Promise<string> {
    if (!path) {
        path = temp.path();
    }
    const deferred = defer<string>();
    const writeStream = fs.createWriteStream(path);
    inStream.on("error", deferred.reject);
    writeStream.on("error", deferred.reject);
    writeStream.on("finish", () => deferred.resolve(path));
    inStream.pipe(writeStream);
    return deferred.promise;
}

export function tryUnlink(path: string): Promise<void> {
    return nodefn.call(fs.unlink, path).catch(() => undefined);
}
