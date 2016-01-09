/// <reference path="../typings/tsd.d.ts" />
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as moment from "moment";
import * as pg from "pg";
import * as temp from "temp";
import {Promise, defer} from "when";

import * as taara from "../lib/index";
import * as API from "../lib/API";

chai.use(chaiAsPromised);
const expect = chai.expect;

temp.track();

describe("Core module", () => {
    const connectionParams = {
        database: "test_user",
        user: "test_user",
        password: "test_password",
        host: "localhost",
        port: 8888
    };

    var pgClient: pg.Client;
    var storageEngine: API.StorageEngine;
    var storageMetadata: API.StorageMetadata;

    function query(query: string): Promise<pg.QueryResult> {
        const deferred = defer<pg.QueryResult>();
        // sadly cannot use nodefn.lift here due to multiple signatures.
        pgClient.query(query, (err, rows) => {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(rows);
            }
        });
        return deferred.promise;
    }

    function assertSame(a: API.SnapshotIdentifier, b: API.SnapshotIdentifier) {
        expect(a.filename()).to.eql(b.filename());
    }

    before((done) => {
        const rootDir = temp.mkdirSync("taara-test-");
        storageEngine = new API.FileSystemEngine(rootDir);
        pgClient = new pg.Client(connectionParams);
        pgClient.connect(done);
    });

    before((done) => {
        const query = `
            DROP TABLE IF EXISTS table_a, table_b CASCADE;
            CREATE TABLE IF NOT EXISTS table_a (x INTEGER PRIMARY KEY, y INTEGER);
            CREATE TABLE IF NOT EXISTS table_b (
                x INTEGER REFERENCES table_a(x),
                w INTEGER
            );
            TRUNCATE TABLE table_a, table_b;

            INSERT INTO table_a
            SELECT index, index FROM generate_series(1, 100) AS index;

            INSERT INTO table_b
            SELECT x, w FROM table_a, generate_series(1, 5) AS w;
        `;
        pgClient.query(query, done);
    });

    after(() => pgClient.end());

    it("should error if no storage engine is configured", (done) => {
        expect(taara.listSnapshots())
            .to.eventually.be.rejectedWith(/No taara storage engine/)
            .notify(done);
    });

    it("should allow setting a storage engine", () => {
        taara.useStorageEngine(storageEngine);
    });

    it("should be able to snapshot multiple tables", (done) => {
        const promise = taara.storeSnapshot(["table_a", "table_b"], {my: "metadata"}, connectionParams);
        promise.then((metadata) => { storageMetadata = metadata; }).done(done);
    });

    it("snappshotting should return the correct metadata", () => {
        expect(storageMetadata.identifier.tablenames).to.eql(["table_a", "table_b"]);
        expect(storageMetadata.identifier.date.dayOfYear).to.eql(moment().utc().dayOfYear);
        expect(storageMetadata.metadata).to.eql({my: "metadata"});
    });

    it("fetching metadata should yield the same metadata", (done) => {
        const promise = taara.getMetadata(storageMetadata.identifier);

        promise.then((metadata) => {
            assertSame(metadata.identifier, storageMetadata.identifier);
            expect(metadata.metadata).to.eql({my: "metadata"});
            done();
        });
    });

    it("should list the same snapshot", (done) => {
        taara.listSnapshots()
            .then((ids) => {
                expect(ids.length).to.equal(1);
                assertSame(ids[0], storageMetadata.identifier);
            })
            .done(done);
    });

    it("should succeed in restoring tables", (done) => {
        const promise = query("DROP TABLE table_a, table_b CASCADE")
            .then(() => taara.restoreSnapshot(storageMetadata.identifier, connectionParams));
        expect(promise).to.eventually.be.fulfilled.notify(done);
    });

    it("should fail to restore tables if they exist", (done) => {
        const promise = taara.restoreSnapshot(storageMetadata.identifier, connectionParams);
        expect(promise).to.eventually.be.rejectedWith(/relation .* already exists/).notify(done);
    });

    it("should succeed in deleting a snapshot", (done) => {
        const promise = taara.deleteSnapshot(storageMetadata.identifier);
        expect(promise).to.eventually.be.fulfilled.notify(done);
    });

    it("should list no snapshots", (done) => {
        expect(taara.listSnapshots()).to.eventually.be.empty.notify(done);
    });

    it("should fail to fetch metadata for deleted snapshot", (done) => {
        const promise = taara.getMetadata(storageMetadata.identifier);
        expect(promise).to.eventually.be.rejected.notify(done);
    });
});
