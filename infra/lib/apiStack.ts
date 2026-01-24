// infra/lib/apiStack.ts
import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";

import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";

import { TripyTables } from "./dbStack";

type ApiStackProps = StackProps & {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient; // REQUIRED for HTTP API user pool authorizer
    tables: TripyTables;
};

export class ApiStack extends Stack {
    constructor(scope: Construct, id: string, props: ApiStackProps) {
        super(scope, id, props);

        // -----------------------------
        // Lambda factory
        // -----------------------------
        const mkFn = (name: string, handler: string) => {
            const fn = new lambda.Function(this, name, {
                functionName: `tripy-${name.toLowerCase()}`,
                runtime: lambda.Runtime.PYTHON_3_12,
                handler,
                code: lambda.Code.fromAsset("../backend"),
                timeout: Duration.seconds(30),
                memorySize: 512,
                environment: {
                    USERS_TABLE: props.tables.users.tableName,
                    TRIPS_TABLE: props.tables.trips.tableName,
                    TRIP_MEMBERS_TABLE: props.tables.tripMembers.tableName,
                    POINTS_TABLE: props.tables.points.tableName,
                    DESTINATIONS_TABLE: props.tables.destinations.tableName,
                    DESTINATION_VOTES_TABLE: props.tables.destinationVotes.tableName,
                    ITINERARY_TABLE: props.tables.itinerary.tableName,
                    USER_POOL_ID: props.userPool.userPoolId,
                },
            });

            // If your Python calls Cognito Admin APIs (optional)
            fn.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsers"],
                    resources: [props.userPool.userPoolArn],
                })
            );

            return fn;
        };

        // -----------------------------
        // Lambdas (make sure handler strings match your backend)
        // -----------------------------
        const usersFn = mkFn("UsersFn", "src.handlers.users.handler");
        const tripsFn = mkFn("TripsFn", "src.handlers.trips.handler");
        const membersFn = mkFn("TripMembersFn", "src.handlers.trip_members.handler");
        const pointsFn = mkFn("PointsFn", "src.handlers.points.handler");
        const destFn = mkFn("DestinationsFn", "src.handlers.destinations.handler");
        const itinFn = mkFn("ItineraryFn", "src.handlers.itinerary.handler");
        const healthFn = mkFn("HealthFn", "src.handlers.health.handler");

        // Permissions (simple + safe for MVP)
        props.tables.users.grantReadWriteData(usersFn);
        props.tables.trips.grantReadWriteData(tripsFn);
        props.tables.tripMembers.grantReadWriteData(membersFn);
        props.tables.points.grantReadWriteData(pointsFn);
        props.tables.destinations.grantReadWriteData(destFn);
        props.tables.destinationVotes.grantReadWriteData(destFn);
        props.tables.itinerary.grantReadWriteData(itinFn);

        // -----------------------------
        // HTTP API v2 + Cognito authorizer
        // -----------------------------
        const httpApi = new apigwv2.HttpApi(this, "TripyHttpApi", {
            apiName: "tripy-http-api",
            // For dev you can allow all; tighten later
            corsPreflight: {
                allowHeaders: ["Content-Type", "Authorization"],
                allowMethods: [
                    apigwv2.CorsHttpMethod.GET,
                    apigwv2.CorsHttpMethod.POST,
                    apigwv2.CorsHttpMethod.PUT,
                    apigwv2.CorsHttpMethod.DELETE,
                    apigwv2.CorsHttpMethod.OPTIONS,
                ],
                allowOrigins: ["*"],
            },
        });

        const userPoolAuthorizer = new authorizers.HttpUserPoolAuthorizer(
            "TripyUserPoolAuthorizer",
            props.userPool,
            {
                userPoolClients: [props.userPoolClient],
                identitySource: ["$request.header.Authorization"],
            }
        );

        const addRoute = (opts: {
            path: string;
            methods: apigwv2.HttpMethod[];
            fn: lambda.Function;
            protected: boolean;
        }) => {
            httpApi.addRoutes({
                path: opts.path,
                methods: opts.methods,
                integration: new integrations.HttpLambdaIntegration(
                    `${opts.fn.node.id}Integration-${opts.path}-${opts.methods.join("-")}`,
                    opts.fn
                ),
                ...(opts.protected
                    ? {
                        authorizer: userPoolAuthorizer,
                    }
                    : {}),
            });
        };

        // -----------------------------
        // Routes (mirror your existing REST resources)
        // -----------------------------
        addRoute({ path: "/health", methods: [apigwv2.HttpMethod.GET], fn: healthFn, protected: false });

        // Users
        addRoute({ path: "/users/me", methods: [apigwv2.HttpMethod.GET], fn: usersFn, protected: true });
        addRoute({ path: "/users/profile", methods: [apigwv2.HttpMethod.PUT], fn: usersFn, protected: true });

        // Trips
        addRoute({ path: "/trips", methods: [apigwv2.HttpMethod.POST], fn: tripsFn, protected: true });
        addRoute({ path: "/trips/get", methods: [apigwv2.HttpMethod.POST], fn: tripsFn, protected: true });
        addRoute({ path: "/trips/invite", methods: [apigwv2.HttpMethod.POST], fn: tripsFn, protected: true });

        // Trip Members
        addRoute({ path: "/trips/join", methods: [apigwv2.HttpMethod.POST], fn: membersFn, protected: true });
        addRoute({ path: "/trips/members", methods: [apigwv2.HttpMethod.POST], fn: membersFn, protected: true });

        // Points
        addRoute({ path: "/points/upsert", methods: [apigwv2.HttpMethod.POST], fn: pointsFn, protected: true });
        addRoute({ path: "/points/summary", methods: [apigwv2.HttpMethod.POST], fn: pointsFn, protected: true });
        addRoute({ path: "/points/valuations", methods: [apigwv2.HttpMethod.GET], fn: pointsFn, protected: true });

        // Destinations
        addRoute({ path: "/destinations/add", methods: [apigwv2.HttpMethod.POST], fn: destFn, protected: true });
        addRoute({ path: "/destinations/list", methods: [apigwv2.HttpMethod.POST], fn: destFn, protected: true });
        addRoute({ path: "/destinations/vote", methods: [apigwv2.HttpMethod.POST], fn: destFn, protected: true });

        // Itinerary
        addRoute({ path: "/itinerary/generate", methods: [apigwv2.HttpMethod.POST], fn: itinFn, protected: true });
        addRoute({ path: "/itinerary/get", methods: [apigwv2.HttpMethod.POST], fn: itinFn, protected: true });

        // -----------------------------
        // Outputs
        // -----------------------------
        new CfnOutput(this, "API_URL", { value: httpApi.apiEndpoint });
    }
}
