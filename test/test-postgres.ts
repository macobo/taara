/// <reference path="../typings/tsd.d.ts" />
import * as _ from "lodash";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as fs from "fs";
import * as pg from "pg";
import * as temp from "temp";
import {Promise, defer} from "when";

import * as API from "../lib/API";
import * as Utils from "../lib/utils";

chai.use(chaiAsPromised);
const expect = chai.expect;

function expectErrorToContain(error: Error, patterns: RegExp[]) {
    for (const pattern of patterns) {
        expect(error.message).to.match(pattern);
    }
}

describe("PostgresDatabaseEngine", () => {
    const connectionParams = {
        database: "test_user",
        user: "test_user",
        password: "test_password",
        host: "localhost",
        port: 8888
    };

    it("should fail to create a stream when cannot connect to a database", (done) => {
        const params = <API.PostgresAuthParams> _.merge({}, connectionParams, {port: 9999});
        const dbEngine = new API.PostgresEngine(params);

        dbEngine.dump(["table_foobar"])
            .then(
                (value) => { throw Error("this should fail"); },
                (error) => expectErrorToContain(error, [
                    /Could not dump tables 'table_foobar'/,
                    /connection to database "test_user"/,
                    /localhost/,
                    /port 9999/
                ])
            )
            .finally(done);
    });

    it("should fail when the table being dumped doesn't exist", (done) => {
        const dbEngine = new API.PostgresEngine(connectionParams);
        const promise = dbEngine.dump(["table_foobar"]);

        expect(promise)
            .to.eventually.be.rejectedWith(/Could not dump tables 'table_foobar': pg_dump: No matching tables were found/)
            .notify(done);
    });

    describe("dump-and-restore", () => {
        var pgClient: pg.Client;
        var dbEngine: API.PostgresEngine;
        const nRows = 10000;

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

        function countRows(tablename: string): Promise<number> {
            return query(`SELECT count(*) FROM ${tablename}`)
                .then((result) => +result.rows[0].count);
        }

        before((done) => {
            dbEngine = new API.PostgresEngine(connectionParams);
            pgClient = new pg.Client(connectionParams);
            pgClient.connect(done);
        });

        before((done) => {
            // Create a composite type, table and dump some values.
            const query = `
                BEGIN;
                DROP TABLE IF EXISTS dumped_table CASCADE;
                DROP TYPE IF EXISTS composite_type;
                CREATE TYPE composite_type AS (
                    foo BIGINT,
                    bar TEXT
                );

                CREATE TABLE dumped_table(
                    id COMPOSITE_TYPE PRIMARY KEY,
                    field TEXT
                );

                INSERT INTO dumped_table
                SELECT (index, 'foobar')::COMPOSITE_TYPE, 'abc'
                FROM generate_series(1, ${nRows}) index;

                COMMIT;
            `;
            pgClient.query(query, done);
        });
        after(() => pgClient.end());

        it("should be able to dump a table", (done) => {
            expect(dbEngine.dump(["dumped_table"]))
                .to.eventually.be.fulfilled
                .notify(done);
        });

        it("should be able to restore a table", (done) => {
            var path = temp.path();
            dbEngine.dump(["dumped_table"])
                .then((dump) => Utils.streamToFile(dump, path))
                .then(() => query("DROP TABLE dumped_table;"))
                .then(() => dbEngine.restore(path))
                .then(() => fs.unlinkSync(path))
                .then(() => expect(countRows("dumped_table")).to.eventually.eql(nRows).notify(done));
        });

        // it("should fail to restore a table if it already exists")
    });
});
