/// <reference path="../typings/tsd.d.ts" />
import {expect} from "chai";
import * as pg from "pg";
import * as temp from "temp";

import * as taara from "../lib/index";
import * as API from "../lib/API";

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
    var dbEngine: API.DatabaseEngine;
    var storageEngine: API.StorageEngine;

    before((done) => {
        const rootDir = temp.mkdirSync("taara-test-")
        dbEngine = new API.PostgresEngine(connectionParams);
        storageEngine = new API.FileSystemEngine(rootDir);
        pgClient = new pg.Client(connectionParams);
        pgClient.connect(done);
    });

    before((done) => {
        const query = `
            DROP TABLE IF EXISTS table_a, table_b CASCADE;
            CREATE TABLE table_a (x INTEGER PRIMARY KEY, y INTEGER);
            CREATE TABLE table_b (
                x INTEGER REFERENCES table_a(x),
                w INTEGER
            );
            
            INSERT INTO table_a
            SELECT index, index FROM generate_series(1, 100) AS index;

            INSERT INTO table_b
            SELECT x, w
            FROM table_a, generate_series(1, 5) AS w;
        `;
        pgClient.query(query, done);
    });

    after(() => pgClient.end());

    it("should be able to snapshot multiple tables", (done) => {
        done();
    });
});
