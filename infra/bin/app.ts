#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/authStack";
import { DbStack } from "../lib/dbStack";
import { RdsStack } from "../lib/rdsStack";
import { RumStack } from "../lib/rumStack";
import { WarmerStack } from "../lib/warmerStack";

// Check if we should use Lambda stack
const useLambda = process.env.USE_LAMBDA === 'true' || process.argv.includes('--lambda');

let ApiStack;
if (useLambda) {
    ApiStack = require("../lib/apiStackLambda").ApiStackLambda;
} else {
    ApiStack = require("../lib/apiStack").ApiStack;
}

const app = new cdk.App();

const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
};

const auth = new AuthStack(app, "TripyAuthStack", { env });
const db = new DbStack(app, "TripyDbStack", { env });

// Aurora Serverless v2 PostgreSQL for the B2B loyalty management system
new RdsStack(app, "TripyRdsStack", { env });

// CloudWatch RUM: identity pool (guest creds) + app monitor for the web frontend
new RumStack(app, "TripyRumStack", { env });

// Scheduled pinger that keeps the cold-start-prone services warm (Amplify SSR
// Lambda + Prisma/Aurora connection + App Runner backend). Override targets via
// CDK context, e.g. `-c warmUrls=https://dev.example.com/api/health,https://...`.
const warmUrlsCtx = app.node.tryGetContext("warmUrls") as string | undefined;
new WarmerStack(app, "TripyWarmerStack", {
    env,
    ...(warmUrlsCtx ? { urls: warmUrlsCtx.split(",").map((u) => u.trim()).filter(Boolean) } : {}),
});

new ApiStack(app, "TripyApiStack", {
    env,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    tables: db.tables,
});

