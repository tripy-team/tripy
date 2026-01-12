import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export type TripyTables = {
    users: dynamodb.Table;
    trips: dynamodb.Table;
    tripMembers: dynamodb.Table;
    points: dynamodb.Table;
    itinerary: dynamodb.Table;
    invites: dynamodb.Table;
};

export class DbStack extends Stack {
    readonly tables: TripyTables;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const removalPolicy =
            (this.node.tryGetContext("env") === "prod") ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

        // USERS
        const users = new dynamodb.Table(this, "UsersTable", {
            tableName: "tripy-users",
            partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
        users.addGlobalSecondaryIndex({
            indexName: "email-index",
            partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // TRIPS
        const trips = new dynamodb.Table(this, "TripsTable", {
            tableName: "tripy-trips",
            partitionKey: { name: "tripId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
        trips.addGlobalSecondaryIndex({
            indexName: "inviteCode-index",
            partitionKey: { name: "inviteCode", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // TRIP MEMBERS (many-to-many)
        const tripMembers = new dynamodb.Table(this, "TripMembersTable", {
            tableName: "tripy-trip-members",
            partitionKey: { name: "tripId", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "userId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
        tripMembers.addGlobalSecondaryIndex({
            indexName: "userId-index",
            partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // POINTS (trip-scoped)
        const points = new dynamodb.Table(this, "PointsTable", {
            tableName: "tripy-points",
            partitionKey: { name: "tripId", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "userProgram", type: dynamodb.AttributeType.STRING }, // userId#PROGRAM
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });


        // ITINERARY (trip-scoped; store items)
        const itinerary = new dynamodb.Table(this, "ItineraryTable", {
            tableName: "tripy-itinerary",
            partitionKey: { name: "tripId", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "itemId", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        const invites = new dynamodb.Table(this, "InvitesTable", {
            tableName: "tripy-invites",
            partitionKey: { name: "inviteCode", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        this.tables = { users, trips, tripMembers, points, itinerary, invites };

        // Outputs
        new CfnOutput(this, "USERS_TABLE", { value: users.tableName });
        new CfnOutput(this, "TRIPS_TABLE", { value: trips.tableName });
        new CfnOutput(this, "TRIP_MEMBERS_TABLE", { value: tripMembers.tableName });
        new CfnOutput(this, "POINTS_TABLE", { value: points.tableName });
        new CfnOutput(this, "ITINERARY_TABLE", { value: itinerary.tableName });
    }
}
