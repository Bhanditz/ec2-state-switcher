'use strict';

const AWS = require('aws-sdk');
const Moment = require("moment");
const Promise = require("bluebird");

const IS_OFFLINE = process.env.IS_OFFLINE;

// Service wide environment variables
const POWER_RANGE = "Running time range";

// Get all EC2 instance from Ireland
const EC2 = new AWS.EC2({
    region: "eu-west-1"
});

let promises = [];

module.exports.main = (event, context, callback) => {

    console.log("Managing EC2 instances: start...");

    // add filter as first param
    EC2.describeInstances({}, (err, data) => {

        const Reservations = data.Reservations || [];

        Reservations.forEach(r => {

            if (r.hasOwnProperty("Instances")) {
                let Instances = r.Instances || [];

                // consider only instances that are running (code 16) ore stopped (code 80)
                Instances = Instances.filter(i => i.State && (i.State.Code === 16 || i.State.Code === 80));

                //Loop each instance
                Instances.forEach(i => {
                    const shouldRunNow = shouldInstanceRunNow(i);

                    console.log("Instance id: ", i.InstanceId, " should run? ", shouldRunNow);

                    promises.push(alignInstanceState(i, shouldRunNow));

                });

            }
        });

        Promise.all(promises).then(() => {

            console.log("Managing EC2 instances: done!");

            // for local development
            if (IS_OFFLINE === 'true') {
                const response = {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: 'Hello from FAO EC2 Switcher!',
                    }),
                };

                callback(null, response);
            }
            else {
                callback(null, {message: 'Hello from FAO EC2 Switcher!', event});
            }
        })
    })
};

const alignInstanceState = (instance, shouldRun) => {

    const instanceIsRunning = isInstanceRunning(instance);

    if (!instanceIsRunning && shouldRun) {

        return new Promise((resolve, reject) => {

            console.log("Start Instance id: ", instance.InstanceId);

            EC2.startInstances({
                InstanceIds: [instance.InstanceId]
            }, (err, data) => {

                if (err) {
                    reject(err);
                    return;
                }

                resolve(data);
            });
        })
    }

    if (instanceIsRunning && !shouldRun) {
        return new Promise((resolve, reject) => {

            console.log("Stop Instance id: ", instance.InstanceId);

            EC2.stopInstances({
                InstanceIds: [instance.InstanceId]
            }, (err, data) => {

                if (err) {
                    reject(err);
                    return;
                }

                resolve(data);
            });
        })
    }
};

const isInstanceRunning = instance => instance.State.Code === 16;

const shouldInstanceRunNow = (instance) => {

    const Tags = instance.Tags || [];
    const rangeTag = Tags.find(t => {
        return t.Key === POWER_RANGE;
    });

    // If the tag is not present or it is not valid
    // leave the instance state as it is
    if (!rangeTag || !isValidRange(rangeTag.Value)) {
        // True only if it is already running
        return isInstanceRunning(instance);
    }

    return isNowIncludedInRange(rangeTag.Value);

};

const isNowIncludedInRange = range => {

    const now = new Moment();

    const r = getFromAndTo(range);
    const from = r.from;
    const to = r.to;

    return now.isBetween(from, to);

};

const getFromAndTo = range => {
    const r = range.split("-");

    return {
        from: Moment.utc(r[0], "HH:mm"),
        to: Moment.utc(r[1], "HH:mm")
    }
};

const isValidRange = range => {

    // Valid range time 00:00-00:00
    const regExp = /^([01]?[0-9]|2[0-3]):[0-5][0-9]-([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

    if (!regExp.test(range)) {
        console.log("Invalid range");
        return false;
    }

    const r = getFromAndTo(range);

    const from = r.from;
    const to = r.to;

    // valid only if 'to' is greater than 'from'
    if (to.diff(from) >= 0) {
        return true;
    }

    console.log("Invalid range");
    return false;

};