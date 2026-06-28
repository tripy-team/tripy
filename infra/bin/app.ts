#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AuthStack } from "../lib/authStack";
import { DbStack } from "../lib/dbStack";
import { RdsStack } from "../lib/rdsStack";
import { RumStack } from "../lib/rumStack";
import { WarmerStack } from "../lib/warmerStack";

// Select the API topology for the (single) "TripyApiStack" stack name:
//   apiStackLambda.ts  -> single monolith Lambda (this is what's deployed in prod)
//   apiStack.ts        -> per-service microservice Lambdas
// These two consume DIFFERENT DbStack tables, so they generate DIFFERENT
// cross-stack exports. Synthesizing the wrong one under the same stack name
// silently churns DbStack's exports — a flagless deploy once tried to delete an
// export still imported by the live stack and CloudFormation rolled it back.
// So require an EXPLICIT choice rather than defaulting; deploy.sh sets
// USE_LAMBDA=true. `--lambda` is still honored as an explicit opt-in.
const lambdaFlag = process.argv.includes('--lambda');
const useLambdaEnv = process.env.USE_LAMBDA; // 'true' | 'false' | undefined
if (useLambdaEnv === undefined && !lambdaFlag) {
    throw new Error(
        "Ambiguous API topology: set USE_LAMBDA explicitly before running CDK.\n" +
        "  USE_LAMBDA=true   -> apiStackLambda.ts (monolith Lambda; the deployed prod topology)\n" +
        "  USE_LAMBDA=false  -> apiStack.ts (per-service microservice Lambdas)\n" +
        "Normally just run ./deploy.sh, which sets USE_LAMBDA=true. A flagless\n" +
        "`cdk deploy` would otherwise synthesize a divergent TripyApiStack and churn\n" +
        "DbStack's cross-stack exports (the cause of the UPDATE_ROLLBACK failure)."
    );
}
const useLambda = useLambdaEnv === 'true' || lambdaFlag;

const ApiStack = useLambda
    ? require("../lib/apiStackLambda").ApiStackLambda
    : require("../lib/apiStack").ApiStack;

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

