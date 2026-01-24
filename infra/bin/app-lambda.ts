#!/usr/bin/env node
// Alternative entry point for Lambda-based deployment
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/authStack";
import { DbStack } from "../lib/dbStack";
import { ApiStackLambda } from "../lib/apiStackLambda";

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
};

const auth = new AuthStack(app, "TripyAuthStack", { env });
const db = new DbStack(app, "TripyDbStack", { env });

// Use Lambda-based API stack
new ApiStackLambda(app, "TripyApiStack", {
    env,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    tables: db.tables,
});
