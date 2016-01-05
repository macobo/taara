/// <reference path="../typings/tsd.d.ts" />
import {expect} from "chai";
import {Promise} from "when";

import * as Utils from "../lib/utils";

describe("Utils", () => {
    describe("readStream", () => {
        it("should convert a readable stream to Promise<string>", (done) => {
            const readStream = Utils.makeReadStream("foobar");
            const promise: Promise<string> = Utils.streamToString(readStream);
            promise
                .then((value) => { expect(value).to.eql("foobar"); })
                .done(done);
        });
    });
});
