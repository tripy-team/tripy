import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export type TripyTables = {
    users: dynamodb.Table;
    trips: dynamodb.Table;
    tripMembers: dynamodb.Table;
    points: dynamodb.Table;
    destinations: dynamodb.ITable;
    destinationVotes: dynamodb.ITable;
    itinerary: dynamodb.Table;
    invites: dynamodb.Table;
    monitoringSubscriptions: dynamodb.Table;
    monitoringBaselines: dynamodb.Table;
    monitoringUpdates: dynamodb.Table;
    rateLimitCounters: dynamodb.Table;
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


        // DESTINATIONS + DESTINATION VOTES — already exist in AWS (created outside CDK).
        // Import as references so apiStack can use them for env vars and permissions.
        const destinations = dynamodb.Table.fromTableName(this, "DestinationsTable", "tripy-destinations");
        const destinationVotes = dynamodb.Table.fromTableName(this, "DestinationVotesTable", "tripy-destination-votes");

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

        // ================================================================
        // MONITORING FEATURE TABLES
        // See docs/KEEP_WATCHING_FEATURE.md for full schema spec
        // ================================================================

        // MONITORING SUBSCRIPTIONS
        // PK: subscription_id (also used for lock items with PK "lock#{trip_id}#{email}")
        const monitoringSubscriptions = new dynamodb.Table(this, "MonitoringSubscriptionsTable", {
            tableName: "tripy-monitoring-subscriptions",
            partitionKey: { name: "subscription_id", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });
        // GSI: trip-email-index — dedupe + lookup by (trip_id, email)
        monitoringSubscriptions.addGlobalSecondaryIndex({
            indexName: "trip-email-index",
            partitionKey: { name: "trip_email_key", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // GSI: trip-index — all subs for a trip
        monitoringSubscriptions.addGlobalSecondaryIndex({
            indexName: "trip-index",
            partitionKey: { name: "trip_id", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // GSI: user-index — all subs for a user
        monitoringSubscriptions.addGlobalSecondaryIndex({
            indexName: "user-index",
            partitionKey: { name: "user_id", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // GSI: due-index — cron job queries active subs due for check
        // PK is state_bucket (e.g. "active#3") for sharding; SK is next_check_at
        monitoringSubscriptions.addGlobalSecondaryIndex({
            indexName: "due-index",
            partitionKey: { name: "state_bucket", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "next_check_at", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // MONITORING BASELINES — snapshot of the trip at opt-in time
        const monitoringBaselines = new dynamodb.Table(this, "MonitoringBaselinesTable", {
            tableName: "tripy-monitoring-baselines",
            partitionKey: { name: "baseline_id", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy,
        });

        // MONITORING UPDATES — stored change records for email click-through
        const monitoringUpdates = new dynamodb.Table(this, "MonitoringUpdatesTable", {
            tableName: "tripy-monitoring-updates",
            partitionKey: { name: "update_id", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: "ttl",
            removalPolicy,
        });
        // GSI: sub-index — all updates for a subscription
        monitoringUpdates.addGlobalSecondaryIndex({
            indexName: "sub-index",
            partitionKey: { name: "subscription_id", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "detected_at", type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // RATE LIMIT COUNTERS — DynamoDB TTL-based rate limiting
        const rateLimitCounters = new dynamodb.Table(this, "RateLimitCountersTable", {
            tableName: "tripy-rate-limit-counters",
            partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: "ttl",
            removalPolicy,
        });

        this.tables = {
            users, trips, tripMembers, points, destinations, destinationVotes,
            itinerary, invites,
            monitoringSubscriptions, monitoringBaselines, monitoringUpdates, rateLimitCounters,
        };

        // Outputs
        new CfnOutput(this, "USERS_TABLE", { value: users.tableName });
        new CfnOutput(this, "TRIPS_TABLE", { value: trips.tableName });
        new CfnOutput(this, "TRIP_MEMBERS_TABLE", { value: tripMembers.tableName });
        new CfnOutput(this, "POINTS_TABLE", { value: points.tableName });
        new CfnOutput(this, "ITINERARY_TABLE", { value: itinerary.tableName });
        new CfnOutput(this, "MONITORING_TABLE_SUBSCRIPTIONS", { value: monitoringSubscriptions.tableName });
        new CfnOutput(this, "MONITORING_TABLE_BASELINES", { value: monitoringBaselines.tableName });
        new CfnOutput(this, "MONITORING_TABLE_UPDATES", { value: monitoringUpdates.tableName });
        new CfnOutput(this, "RATE_LIMIT_TABLE", { value: rateLimitCounters.tableName });
    }
}
