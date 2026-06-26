import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

export interface WarmerStackProps extends StackProps {
    /**
     * URLs to ping on a schedule to keep the cold-start-prone services warm.
     * Defaults target production; override via context for dev/staging.
     */
    urls?: string[];
    /** How often to ping. Must be shorter than the idle thresholds you're fighting. */
    intervalMinutes?: number;
}

/**
 * Keeps the first-load data path warm.
 *
 * The first request after an idle period pays a cold-start tax in three places:
 *   1. the Amplify SSR Lambda spinning up,
 *   2. Prisma opening a fresh connection to Aurora, and
 *   3. the App Runner backend resuming a paused instance.
 *
 * A tiny Lambda pings the frontend `/api/health` route (which runs a real
 * `SELECT 1` through Prisma, warming #1 and #2) and the backend `/health`
 * (warming #3) every few minutes, so real users almost never hit a cold start.
 *
 * 4-minute cadence is deliberately under the ~5-minute idle window that lets a
 * Lambda go cold / an App Runner instance pause.
 */
export class WarmerStack extends Stack {
    constructor(scope: Construct, id: string, props?: WarmerStackProps) {
        super(scope, id, props);

        const urls = props?.urls ?? [
            "https://tripshacker.com/api/health",
            "https://xezfenhu6t.us-east-1.awsapprunner.com/health",
        ];
        const intervalMinutes = props?.intervalMinutes ?? 4;

        // Inline Node.js so there is nothing to bundle — it only uses the runtime's
        // built-in https module to fire GETs at each target and log the outcome.
        const warmerFn = new lambda.Function(this, "WarmerFn", {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: "index.handler",
            timeout: Duration.seconds(30),
            memorySize: 128,
            environment: { WARM_URLS: urls.join(",") },
            code: lambda.Code.fromInline(`
const https = require("https");
const http = require("http");

function ping(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 25000 }, (res) => {
      res.resume(); // drain so the socket frees
      res.on("end", () =>
        resolve({ url, status: res.statusCode, ms: Date.now() - started })
      );
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, status: "timeout", ms: Date.now() - started });
    });
    req.on("error", (err) =>
      resolve({ url, status: "error: " + err.message, ms: Date.now() - started })
    );
  });
}

exports.handler = async () => {
  const urls = (process.env.WARM_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
  const results = await Promise.all(urls.map(ping));
  for (const r of results) console.log("[warmer]", JSON.stringify(r));
  return { results };
};
            `),
        });

        new events.Rule(this, "WarmerSchedule", {
            schedule: events.Schedule.rate(Duration.minutes(intervalMinutes)),
            targets: [new targets.LambdaFunction(warmerFn)],
        });

        new CfnOutput(this, "WarmerUrls", { value: urls.join(", ") });
        new CfnOutput(this, "WarmerIntervalMinutes", { value: String(intervalMinutes) });
    }
}
