import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import { TripyTables } from "./dbStack";

type ApiStackProps = StackProps & {
    userPool: cognito.UserPool;
    tables: TripyTables;
};

export class ApiStack extends Stack {
    constructor(scope: Construct, id: string, props: ApiStackProps) {
        super(scope, id, props);

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

            // MVP permissions (later you can tighten per-function)
            props.tables.users.grantReadWriteData(fn);
            props.tables.trips.grantReadWriteData(fn);
            props.tables.tripMembers.grantReadWriteData(fn);
            props.tables.points.grantReadWriteData(fn);
            props.tables.destinations.grantReadWriteData(fn);
            props.tables.destinationVotes.grantReadWriteData(fn);
            props.tables.itinerary.grantReadWriteData(fn);

            // Optional: only if you call cognito-idp in Python (most MVPs don’t need this)
            fn.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsers"],
                    resources: [props.userPool.userPoolArn],
                })
            );

            return fn;
        };

        // Lambdas
        const usersFn = mkFn("UsersFn", "src.handlers.users.handler");
        const tripsFn = mkFn("TripsFn", "src.handlers.trips.handler");
        const membersFn = mkFn("TripMembersFn", "src.handlers.trip_members.handler");
        const pointsFn = mkFn("PointsFn", "src.handlers.points.handler");
        const destFn = mkFn("DestinationsFn", "src.handlers.destinations.handler");
        const itinFn = mkFn("ItineraryFn", "src.handlers.itinerary.handler");
        const healthFn = mkFn("HealthFn", "src.handlers.health.handler");

        // REST API
        const api = new apigw.RestApi(this, "TripyRestApi", {
            restApiName: "tripy-rest-api",
            defaultCorsPreflightOptions: {
                allowOrigins: apigw.Cors.ALL_ORIGINS,
                allowMethods: apigw.Cors.ALL_METHODS,
                allowHeaders: ["Content-Type", "Authorization"],
            },
        });

        // Cognito Authorizer
        const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "TripyAuthorizer", {
            cognitoUserPools: [props.userPool],
            identitySource: "method.request.header.Authorization",
        });
        authorizer._attachToApi(api);

        // Helpers
        const addLambdaRoute = (
            resource: apigw.IResource,
            method: string,
            fn: lambda.Function,
            auth: boolean = true
        ) => {
            resource.addMethod(method, new apigw.LambdaIntegration(fn), auth
                ? { authorizationType: apigw.AuthorizationType.COGNITO, authorizer }
                : { authorizationType: apigw.AuthorizationType.NONE }
            );
        };

        // Routes
        const health = api.root.addResource("health");
        addLambdaRoute(health, "GET", healthFn, false);

        const users = api.root.addResource("users");
        const usersMe = users.addResource("me");
        addLambdaRoute(usersMe, "GET", usersFn, true);

        const usersProfile = users.addResource("profile");
        addLambdaRoute(usersProfile, "PUT", usersFn, true);

        const trips = api.root.addResource("trips");
        addLambdaRoute(trips, "POST", tripsFn, true);

        const tripsGet = trips.addResource("get");
        addLambdaRoute(tripsGet, "POST", tripsFn, true);

        const tripsInvite = trips.addResource("invite");
        addLambdaRoute(tripsInvite, "POST", tripsFn, true);

        const tripsJoin = trips.addResource("join");
        addLambdaRoute(tripsJoin, "POST", membersFn, true);

        const tripsMembers = trips.addResource("members");
        addLambdaRoute(tripsMembers, "POST", membersFn, true);

        const points = api.root.addResource("points");
        const pointsUpsert = points.addResource("upsert");
        addLambdaRoute(pointsUpsert, "POST", pointsFn, true);

        const pointsSummary = points.addResource("summary");
        addLambdaRoute(pointsSummary, "POST", pointsFn, true);

        const destinations = api.root.addResource("destinations");
        const destAdd = destinations.addResource("add");
        addLambdaRoute(destAdd, "POST", destFn, true);

        const destList = destinations.addResource("list");
        addLambdaRoute(destList, "POST", destFn, true);

        const destVote = destinations.addResource("vote");
        addLambdaRoute(destVote, "POST", destFn, true);

        const itinerary = api.root.addResource("itinerary");
        const itinGenerate = itinerary.addResource("generate");
        addLambdaRoute(itinGenerate, "POST", itinFn, true);

        const itinGet = itinerary.addResource("get");
        addLambdaRoute(itinGet, "POST", itinFn, true);

        new CfnOutput(this, "API_URL", { value: api.url });
    }
}
