// infra/lib/apiStackLambda.ts
// Updated CDK stack for Lambda-based FastAPI deployment

import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
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
            code: lambda.Code.fromAsset("../backend", {
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
                AWS_REGION: this.region || "us-east-1",
                
                // Image service (if configured)
                CITY_IMAGES_BUCKET: process.env.CITY_IMAGES_BUCKET || "tripy-city-images",
                CITY_IMAGES_TABLE: process.env.CITY_IMAGES_TABLE || "tripy-city-images",
                CLOUDFRONT_DOMAIN: process.env.CLOUDFRONT_DOMAIN || "",
                
                // CORS (set in production)
                CORS_ORIGINS: process.env.CORS_ORIGINS || "*",
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
            code: lambda.Code.fromAsset("../backend", {
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
                AWS_REGION: this.region || "us-east-1",
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

        // Cognito Authorizer
        const userPoolAuthorizer = new authorizers.HttpUserPoolAuthorizer(
            "TripyUserPoolAuthorizer",
            props.userPool,
            {
                userPoolClients: [props.userPoolClient],
                identitySource: ["$request.header.Authorization"],
            }
        );

        // -----------------------------
        // Routes - Catch-all for FastAPI
        // -----------------------------
        // FastAPI handles routing internally, so we use a catch-all route
        const apiIntegration = new integrations.HttpLambdaIntegration(
            "ApiIntegration",
            apiFunction
        );

        // Public routes (no auth)
        httpApi.addRoutes({
            path: "/health",
            methods: [apigwv2.HttpMethod.GET],
            integration: apiIntegration,
        });

        httpApi.addRoutes({
            path: "/auth/{proxy+}",
            methods: [
                apigwv2.HttpMethod.GET,
                apigwv2.HttpMethod.POST,
                apigwv2.HttpMethod.PUT,
            ],
            integration: apiIntegration,
        });

        // Protected routes (with auth)
        const protectedRoutes = [
            "/users/{proxy+}",
            "/trips/{proxy+}",
            "/destinations/{proxy+}",
            "/itinerary/{proxy+}",
            "/points/{proxy+}",
            "/images/{proxy+}",
        ];

        protectedRoutes.forEach((path) => {
            httpApi.addRoutes({
                path,
                methods: [
                    apigwv2.HttpMethod.GET,
                    apigwv2.HttpMethod.POST,
                    apigwv2.HttpMethod.PUT,
                    apigwv2.HttpMethod.DELETE,
                    apigwv2.HttpMethod.PATCH,
                ],
                integration: apiIntegration,
                authorizer: userPoolAuthorizer,
            });
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
    }
}
