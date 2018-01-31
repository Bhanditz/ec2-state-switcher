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

    console.log("Managing EC2 instances: start... ", formatDate(new Moment()));

    // add filter as first param
    EC2.describeInstances({}, (err, data) => {

        const Reservations = data.Reservations || [];

        Reservations.forEach(r => {

            if (r.hasOwnProperty("Instances")) {
                let Instances = r.Instances || [];

                Instances = Instances.filter(i => i.State && (isInstanceRunning(i) || isInstanceStopped(i)));

                //Loop each instance
                Instances.forEach(i => {
                    const shouldRunNow = shouldInstanceRunNow(i);

                    if (shouldRunNow !== isInstanceRunning(i)) {
                        printInstanceStateChangeLogs(i, shouldRunNow)
                    }

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
                        message: 'Hello from FAO EC2 Switcher! [HTTP]',
                    }),
                };

                callback(null, response);
            }
            else {
                callback(null, {message: 'Hello from FAO EC2 Switcher! [fn()]', event});
            }
        })
    })
};

const alignInstanceState = (instance, shouldRun) => {

    const instanceIsRunning = isInstanceRunning(instance);

    if (!instanceIsRunning && shouldRun) {

        return new Promise((resolve, reject) => {

            console.log("Starting: ", printInstanceName(instance));

            EC2.startInstances({
                InstanceIds: [instance.InstanceId]
            }, (err, data) => {

                if (err) {
                    console.log("Error on starting: ", printInstanceName(instance));
                    console.log(JSON.stringify(err));

                    reject(err);
                    return;
                }

                console.log("Started successfully: ", printInstanceName(instance));

                resolve(data);
            });
        })
    }

    if (instanceIsRunning && !shouldRun) {
        return new Promise((resolve, reject) => {

            console.log("Stopping: ", printInstanceName(instance));

            EC2.stopInstances({
                InstanceIds: [instance.InstanceId]
            }, (err, data) => {

                if (err) {
                    console.log("Error on stopping: ", printInstanceName(instance));
                    console.log(JSON.stringify(err));
                    reject(err);
                    return;
                }

                console.log("Stopped successfully: ", printInstanceName(instance));

                resolve(data);
            });
        })
    }
};

const isInstanceRunning = instance => instance.State.Code === 16;

const isInstanceStopped = instance => instance.State.Code === 80;

const shouldInstanceRunNow = (instance) => {

    const rangeTag = getTag(instance, POWER_RANGE);

    // If the tag is not present or it is not valid
    // leave the instance state as it is
    if (!rangeTag || !isValidRange(rangeTag.Value)) {
        // True only if it is already running
        return isInstanceRunning(instance);
    }

    return isNowIncludedInRange(rangeTag.Value);

};

const getTag = (instance, key) => {
    const Tags = instance.Tags || [];
    return Tags.find(t => {
        return t.Key === key;
    });
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
    const from = r[0].split(":");
    const to = r[1].split(":");

    return {
        from: new Moment().startOf('day').add(from[0], "hours").add(from[1], "minutes"),
        to: new Moment().startOf('day').add(to[0], "hours").add(to[1], "minutes"),
    }
};

const isValidRange = range => {


    // Valid range time 00:00-00:00
    const regExp = /^([01]?[0-9]|2[0-3]):[0-5][0-9]-([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

    if (!regExp.test(range)) {
        console.log("Invalid range. Unknown format. ", range);
        return false;
    }

    const r = getFromAndTo(range);

    const from = r.from;
    const to = r.to;

    // valid only if 'to' is greater than 'from'
    if (to.diff(from) >= 0) {
        return true;
    }

    console.log("Invalid range. End time must be after Start time. ", range);
    return false;

};

const printInstanceName = instance => {
    const name = getTag(instance, "Name") || {};
    return name.Value + " [" + instance.InstanceId + "]";
};

const formatDate = momentDateObj => momentDateObj.format("hh:mm");

const printInstanceStateChangeLogs = (instance, shouldRunNow) => {

    const range = getTag(instance, POWER_RANGE).Value;
    const now = new Moment();

    console.log("");
    console.log("=== Instance state change required:", printInstanceName(instance), "====");

    console.log("Configuration");
    console.log("\tRange\t", range);
    console.log("\tNow\t", formatDate(now));

    console.log("Desired state:");
    console.log("\tinstance", shouldRunNow ? "should run." : "should be stopped.");

    console.log("State found:");
    if (isInstanceRunning(instance)) {
        console.log("\trunning.");
    }
    if (isInstanceStopped(instance)) {
        console.log("\tstopped");
    }

};