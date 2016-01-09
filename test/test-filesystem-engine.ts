/// <reference path="../typings/tsd.d.ts" />
import {expect} from "chai";
import * as fs from "fs";
import * as moment from "moment";
import * as path from "path";
import * as temp from "temp";
import {Promise} from "when";

import * as API from "../lib/API";

temp.track();

describe("Models", () => {
    describe("SnapshotIdentifier", () => {
        it("can be converted to a filename", () => {
            const date = moment.utc([2016, 1, 1]);
            const id = new API.SnapshotIdentifier(["mytablename"], date);
            expect(id.filename()).to.eql("mytablename.20160201-000000.snapshot");
        });

        it("can be reconstructed from a filename", () => {
            const id = API.getIdentifier("my-table.name.20160201-112233");
            expect(id.tablenames).to.eql(["my-table.name"]);
            expect(id.date.format()).to.eql("2016-02-01T11:22:33+00:00");
        });
    });

    describe("StorageMetadata", () => {
        it("can be converted to json and back", () => {
            const date = moment.utc([2016, 1, 1]);
            const data: API.StorageMetadata = {
                identifier: new API.SnapshotIdentifier(["mytablename"], date),
                stats: { foo: 5 },
                metadata: { offset: [1, 2, 3] }
            };

            const json = API.StorageMetadata.toJSON(data);
            const newData = API.StorageMetadata.fromJson(json);
            expect(newData.stats).to.deep.equal(data.stats);
            expect(newData.metadata).to.deep.equal(data.metadata);
            expect(newData.identifier.filename()).to.deep.equal(data.identifier.filename());
        });
    });
});

interface PublicAbstractFileSystemEngine {
    delete(path: string): Promise<void>;
    ls(path: string): Promise<Array<API.FileDescriptor>>;
    readContents(path: string): Promise<string>;
    copyFileToLocalDisk(source: string, potentialDestination: string): Promise<string>;
    uploadData(path: string, data: string): Promise<any>;
    uploadFile(path: string, data: string): Promise<any>;
    delete(path: string): Promise<void>;
}

function test(engine: PublicAbstractFileSystemEngine, rootPath: string) {
    const plainFile = path.join(rootPath, "plain.ext");
    const nestedFile = path.join(rootPath, "nested/foo.bar");

    describe("native methods", () => {
        it("should be able to list an empty directory", (done) => {
            engine.ls(rootPath)
                .then((files) => { expect(files).to.be.empty; })
                .done(done);
        });

        it("should be able to upload a data blob", (done) => {
            engine
                .uploadData(plainFile, "filecontent")
                .done(done);
        });

        it("should be able to upload a file", (done) => {
            const tempPath = temp.path();
            fs.writeFileSync(tempPath, "secondfileee");
            engine.uploadFile(nestedFile, tempPath).done(done);
        });

        it("should list the new file", (done) => {
            engine.ls(rootPath)
                .then((files) => {
                    expect(files).to.eql([{
                        filename: "plain",
                        extension: "ext"
                    }]);
                }).done(done);
        });

        it("should list the nested file", (done) => {
            engine.ls(path.join(rootPath, "nested"))
                .then((files) => {
                    expect(files).to.eql([{
                        filename: "foo",
                        extension: "bar"
                    }]);
                }).done(done);
        });

        it("should be able to read the file", (done) => {
            engine.readContents(plainFile)
                .then((contents) => {
                    expect(contents).to.eql("filecontent");
                })
                .done(done);
        });

        it("should be able to delete the file", (done) => {
            engine.delete(plainFile)
                .then(() => engine.delete(nestedFile))
                .then(() => engine.ls(rootPath))
                .then((files) => { expect(files).to.be.empty; })
                .done(done);
        });
    });
}

describe("FileSystemEngine", () => {
    class PublicFileSystemEngine extends API.FileSystemEngine implements PublicAbstractFileSystemEngine {
        public delete(path: string) { return super.delete(path); }
        public ls(path: string) { return super.ls(path); }
        public readContents(path: string) { return super.readContents(path); }
        public uploadData(path: string, content: string) {
            return super.uploadData(path, content);
        }
        public uploadFile(destination: string, localPath: string) {
            return super.uploadFile(destination, localPath);
        }
        public copyFileToLocalDisk(source: string, localPath: string) {
            return super.copyFileToLocalDisk(source, localPath);
        }
    }

    const rootPath = temp.mkdirSync("taara-fs-test-");
    test(new PublicFileSystemEngine(rootPath), rootPath);
});

describe("S3StorageEngine", () => {
    class PublicS3StorageEngine extends API.S3StorageEngine implements PublicAbstractFileSystemEngine {
        public delete(path: string) { return super.delete(path); }
        public ls(path: string) { return super.ls(path); }
        public readContents(path: string) { return super.readContents(path); }
        public uploadData(path: string, content: string) {
            return super.uploadData(path, content);
        }
        public uploadFile(destination: string, localPath: string) {
            return super.uploadFile(destination, localPath);
        }
        public copyFileToLocalDisk(source: string, localPath: string) {
            return super.copyFileToLocalDisk(source, localPath);
        }
    }

    // assumes fake_s3 is running in docker-compose
    const bucketName = "taara-test-bucket";
    const config = {
        endpoint: "localhost:4569",
        sslEnabled: false,
        s3ForcePathStyle: true,
        accessKeyId: "foo",
        secretAccessKey: "bar"
    };
    const engine = new PublicS3StorageEngine(bucketName, config);

    before((done) => {
        engine.aws_s3.createBucket({Bucket: bucketName}, done);
    });

    test(engine, "");
});
