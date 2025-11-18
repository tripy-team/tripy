import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as tableV2 from "aws-cdk-lib/aws-dynamodb";

export class dbStack extends Stack {
    readonly usersInfoTable: tableV2.TableV2
    readonly usersTripTable: tableV2.TableV2
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        this.usersInfoTable = new tableV2.TableV2(this, "usersInfoTableStack", {
            partitionKey: { name: "email", type: tableV2.AttributeType.STRING },
            deletionProtection: true,
            tableName: "usersInfoTable"
        })

        this.usersTripTable = new tableV2.TableV2(this, "usersTripTableStack", {
            partitionKey: { name: "email", type: tableV2.AttributeType.STRING },
            sortKey: { name: "tripNumber", type: tableV2.AttributeType.NUMBER },
            tableName: "usersTripTable"
        })
    }
}