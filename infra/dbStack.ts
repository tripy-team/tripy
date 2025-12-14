import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as tableV2 from "aws-cdk-lib/aws-dynamodb";
import { AuthPayload } from "./authStack";

export class dbStack extends Stack {
    readonly usersTable: tableV2.TableV2
    readonly tripsTable: tableV2.TableV2
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        this.usersTable = new tableV2.TableV2(this, "usersInfoTableStack", {
            partitionKey: { name: "userId", type: tableV2.AttributeType.STRING },
            deletionProtection: true,
            tableName: "usersInfoTable"
        })

        this.tripsTable = new tableV2.TableV2(this, "usersTripTableStack", {
            partitionKey: { name: "tripId", type: tableV2.AttributeType.STRING },
            sortKey: { name: "createdBy", type: tableV2.AttributeType.NUMBER },
            tableName: "tripsTable"
        })
    }

    create_user(authPayload: AuthPayload) {

    }

    get_user_by_id(userId: string) {

    }

    get_user_by_email(email: string) {

    }

    update_user_info(userId: string, updateData: any) {

    }

    get_current_user(sessionToken: string) {

    }

    set_default_home_airport(userId: string, airportCode: string) {

    }

    set_user_timezone(userId: string, timezone: string) {

    }

    create_trip(userId: string, title: string, startDate: string, endDate: string) {
    }

    get_trip(tripId: string) {
    }

    update_trip(tripId: string, updates: JSON) {

    }

    archive_trip(tripId: string) {

    }

    delete_trip(tripId: string) { }

    generate_invite_code(tripId: string) { }

    get_trip_by_invite_code(inviteCode: string) { }

    is_user_authorized_for_trip(userId: string, tripId: string) { }
}