# AWS EC2 state switcher

Stop or start you EC2 based on a tag.

## Tag your EC2 instances to be managed

Each instance with the "Running time range" tag will be managed by the Switcher.
Specify your time range with the format 00:00-00:00.
The lambda function keep you instance up and running during the specified range and will shut it down otherwise. 

## Dev spec

The project is based on Serverless Framework. Offline plugin is used for local dev.

## Commands

```
# Start the offline server for local dev
$ sls offline start

# Deploy!
$ sls deploy
```
