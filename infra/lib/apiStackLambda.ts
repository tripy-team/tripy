// infra/lib/apiStackLambda.ts
// Updated CDK stack for Lambda-based FastAPI deployment

import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as logs from "aws-cdk-lib/aws-logs";

import { TripyTables } from "./dbStack";

type ApiStackProps = StackProps & {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    tables: TripyTables;
};

export class ApiStackLambda extends Stack {
    constructor(scope: Construct, id: string, props: ApiStackProps) {
        super(scope, id, props);

        // -----------------------------
        // Main FastAPI Lambda Function
        // -----------------------------
        const apiFunction = new lambda.Function(this, "TripyApiFunction", {
            functionName: "tripy-api",
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "src.lambda_handler.lambda_handler",
            code: lambda.Code.fromAsset("../backend/.lambda-build", {
                exclude: [
                    "**/__pycache__",
                    "**/*.pyc",
                    "**/.pytest_cache",
                    "**/test_*.py",
                    "**/tests",
                    "**/.env",
                    "**/node_modules",
                ],
            }),
            timeout: Duration.seconds(30), // API Gateway max is 30s
            memorySize: 1024, // Increased for FastAPI overhead
            environment: {
                // DynamoDB Tables
                USERS_TABLE: props.tables.users.tableName,
                TRIPS_TABLE: props.tables.trips.tableName,
                TRIP_MEMBERS_TABLE: props.tables.tripMembers.tableName,
                POINTS_TABLE: props.tables.points.tableName,
                DESTINATIONS_TABLE: props.tables.destinations.tableName,
                DESTINATION_VOTES_TABLE: props.tables.destinationVotes.tableName,
                ITINERARY_TABLE: props.tables.itinerary.tableName,
                
                // Cognito
                USER_POOL_ID: props.userPool.userPoolId,
                USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
                
                // Image service (if configured)
                CITY_IMAGES_BUCKET: process.env.CITY_IMAGES_BUCKET || "tripy-city-images",
                CITY_IMAGES_TABLE: process.env.CITY_IMAGES_TABLE || "tripy-city-images",
                CLOUDFRONT_DOMAIN: process.env.CLOUDFRONT_DOMAIN || "",
                
                // CORS (set in production)
                CORS_ORIGINS: process.env.CORS_ORIGINS || "*",

                // B2B Tables
                ORGANIZATIONS_TABLE: props.tables.organizations.tableName,
                ORG_MEMBERS_TABLE: props.tables.orgMembers.tableName,
                CLIENTS_TABLE: props.tables.clients.tableName,
                CLIENT_POINTS_TABLE: props.tables.clientPoints.tableName,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });

        // Grant DynamoDB permissions
        props.tables.users.grantReadWriteData(apiFunction);
        props.tables.trips.grantReadWriteData(apiFunction);
        props.tables.tripMembers.grantReadWriteData(apiFunction);
        props.tables.points.grantReadWriteData(apiFunction);
        props.tables.destinations.grantReadWriteData(apiFunction);
        props.tables.destinationVotes.grantReadWriteData(apiFunction);
        props.tables.organizations.grantReadWriteData(apiFunction);
        props.tables.orgMembers.grantReadWriteData(apiFunction);
        props.tables.clients.grantReadWriteData(apiFunction);
        props.tables.clientPoints.grantReadWriteData(apiFunction);
        props.tables.itinerary.grantReadWriteData(apiFunction);

        // Cognito permissions
        apiFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:ListUsers",
                ],
                resources: [props.userPool.userPoolArn],
            })
        );

        // S3 permissions for image service
        apiFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: [
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:DeleteObject",
                ],
                resources: [
                    `arn:aws:s3:::${process.env.CITY_IMAGES_BUCKET || "tripy-city-images"}/*`,
                ],
            })
        );

        // Kinesis Firehose for analytics (if configured)
        if (process.env.ANALYTICS_FIREHOSE_STREAM) {
            apiFunction.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ["firehose:PutRecord"],
                    resources: [
                        `arn:aws:firehose:${this.region}:${this.account}:deliverystream/${process.env.ANALYTICS_FIREHOSE_STREAM}`,
                    ],
                })
            );
        }

        // -----------------------------
        // Background Tasks Lambda (for long-running operations)
        // -----------------------------
        const backgroundTasksFunction = new lambda.Function(this, "TripyBackgroundTasks", {
            functionName: "tripy-background-tasks",
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "src.lambda_background_tasks.lambda_handler",
            code: lambda.Code.fromAsset("../backend/.lambda-build", {
                exclude: [
                    "**/__pycache__",
                    "**/*.pyc",
                    "**/.pytest_cache",
                    "**/test_*.py",
                    "**/tests",
                    "**/.env",
                ],
            }),
            timeout: Duration.minutes(15), // Longer timeout for background tasks
            memorySize: 1024,
            environment: {
                CITY_IMAGES_BUCKET: process.env.CITY_IMAGES_BUCKET || "tripy-city-images",
                CITY_IMAGES_TABLE: process.env.CITY_IMAGES_TABLE || "tripy-city-images",
                CITIES_JSON_PATH: "scripts/cities.json",
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });

        // Grant S3 and DynamoDB permissions for background tasks
        backgroundTasksFunction.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                resources: [
                    `arn:aws:s3:::${process.env.CITY_IMAGES_BUCKET || "tripy-city-images"}/*`,
                ],
            })
        );

        // Allow API function to invoke background tasks
        backgroundTasksFunction.grantInvoke(apiFunction);

        // -----------------------------------------------
        // SQS Queue + Worker Lambda for async itinerary generation
        // -----------------------------------------------
        const generationDLQ = new sqs.Queue(this, "ItineraryGenerationDLQ", {
            queueName: "tripy-itinerary-generation-dlq",
            retentionPeriod: Duration.days(14),
        });

        const generationQueue = new sqs.Queue(this, "ItineraryGenerationQueue", {
            queueName: "tripy-itinerary-generation",
            visibilityTimeout: Duration.minutes(10),
            retentionPeriod: Duration.days(3),
            deadLetterQueue: { queue: generationDLQ, maxReceiveCount: 3 },
        });

        const itineraryWorker = new lambda.Function(this, "ItineraryWorker", {
            functionName: "tripy-itinerary-worker",
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "src.workers.itinerary_worker.handler",
            code: lambda.Code.fromAsset("../backend/.lambda-build", {
                exclude: [
                    "**/__pycache__", "**/*.pyc",
                    "**/.pytest_cache", "**/test_*.py",
                    "**/tests", "**/.env",
                ],
            }),
            timeout: Duration.minutes(10),
            memorySize: 2048,
            environment: {
                USERS_TABLE: props.tables.users.tableName,
                TRIPS_TABLE: props.tables.trips.tableName,
                TRIP_MEMBERS_TABLE: props.tables.tripMembers.tableName,
                POINTS_TABLE: props.tables.points.tableName,
                DESTINATIONS_TABLE: props.tables.destinations.tableName,
                DESTINATION_VOTES_TABLE: props.tables.destinationVotes.tableName,
                ITINERARY_TABLE: props.tables.itinerary.tableName,
                USE_SECRETS_MANAGER: "true",
                SECRETS_MANAGER_SECRET_NAME: "tripy/production/api-keys",
                PYTHONPATH: "/var/task",
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });

        itineraryWorker.addEventSource(
            new lambdaEventSources.SqsEventSource(generationQueue, {
                batchSize: 1,
            }),
        );

        // Grant the worker access to all tables it needs
        props.tables.users.grantReadWriteData(itineraryWorker);
        props.tables.trips.grantReadWriteData(itineraryWorker);
        props.tables.tripMembers.grantReadData(itineraryWorker);
        props.tables.points.grantReadData(itineraryWorker);
        props.tables.destinations.grantReadData(itineraryWorker);
        props.tables.destinationVotes.grantReadData(itineraryWorker);
        props.tables.itinerary.grantReadWriteData(itineraryWorker);

        // Secrets Manager for API keys
        itineraryWorker.addToRolePolicy(
            new iam.PolicyStatement({
                actions: ["secretsmanager:GetSecretValue"],
                resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:tripy/production/api-keys*`],
            }),
        );

        // Allow the API Lambda to send messages to the queue
        generationQueue.grantSendMessages(apiFunction);

        // Pass queue URL to the API Lambda
        apiFunction.addEnvironment("GENERATION_QUEUE_URL", generationQueue.queueUrl);

        // -----------------------------
        // HTTP API Gateway
        // -----------------------------
        const httpApi = new apigwv2.HttpApi(this, "TripyHttpApi", {
            apiName: "tripy-http-api",
            corsPreflight: {
                allowHeaders: [
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Api-Key",
                    "X-Amz-Security-Token",
                    // Sent by the frontend on anonymous/non-auth requests (e.g. signup).
                    // Without this, the CORS preflight for those requests fails.
                    "X-Anon-Session-Id",
                ],
                allowMethods: [
                    apigwv2.CorsHttpMethod.GET,
                    apigwv2.CorsHttpMethod.POST,
                    apigwv2.CorsHttpMethod.PUT,
                    apigwv2.CorsHttpMethod.DELETE,
                    apigwv2.CorsHttpMethod.OPTIONS,
                    apigwv2.CorsHttpMethod.PATCH,
                ],
                allowOrigins: process.env.CORS_ORIGINS
                    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
                    : ["*"],
                maxAge: Duration.days(1),
            },
        });

        // -----------------------------
        // Routes - Catch-all for FastAPI
        // -----------------------------
        // FastAPI owns ALL routing and auth internally:
        //   - It verifies Cognito JWTs (signature/issuer/audience via JWKS) in
        //     src/utils/jwt_auth.py, so a gateway-level Cognito authorizer is
        //     redundant.
        //   - It supports anonymous B2C sessions (X-Anon-Session-Id) for routes
        //     like /solo and /optimize, which a gateway authorizer would block.
        //   - It emits CORS headers via CORSMiddleware. A gateway authorizer's
        //     401s do NOT carry CORS headers, which breaks the frontend's
        //     token-refresh flow (it must be able to read the 401).
        //
        // Enumerating routes here previously dropped whole route groups
        // (/orgs, /clients, /solo, /optimize, /intake, ...) — unmatched paths
        // returned API Gateway's own CORS-less 404, surfacing in the browser as
        // "No 'Access-Control-Allow-Origin' header". A single catch-all avoids
        // that and stays in sync with the app automatically.
        const apiIntegration = new integrations.HttpLambdaIntegration(
            "ApiIntegration",
            apiFunction
        );

        httpApi.addRoutes({
            path: "/{proxy+}",
            methods: [
                apigwv2.HttpMethod.GET,
                apigwv2.HttpMethod.POST,
                apigwv2.HttpMethod.PUT,
                apigwv2.HttpMethod.DELETE,
                apigwv2.HttpMethod.PATCH,
            ],
            integration: apiIntegration,
        });

        // -----------------------------
        // Outputs
        // -----------------------------
        new CfnOutput(this, "API_URL", {
            value: httpApi.apiEndpoint,
            description: "API Gateway endpoint URL",
        });

        new CfnOutput(this, "API_FUNCTION_NAME", {
            value: apiFunction.functionName,
            description: "Main API Lambda function name",
        });

        new CfnOutput(this, "BACKGROUND_TASKS_FUNCTION_NAME", {
            value: backgroundTasksFunction.functionName,
            description: "Background tasks Lambda function name",
        });

        new CfnOutput(this, "GENERATION_QUEUE_URL", {
            value: generationQueue.queueUrl,
            description: "SQS queue URL for async itinerary generation",
        });

        new CfnOutput(this, "ITINERARY_WORKER_FUNCTION_NAME", {
            value: itineraryWorker.functionName,
            description: "Itinerary worker Lambda function name",
        });
    }
}
