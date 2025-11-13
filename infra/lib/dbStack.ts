import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as tableV2 from "aws-cdk-lib/aws-dynamodb";

export class db extends Stack {
    readonly table: tableV2.TableV2
    constructor(scope: Construct, id: string, functionName: string, props?: StackProps) {
        super(scope, id, props)

        this.table = new tableV2.TableV2(this, id, {
            partitionKey: { name: "email", type: tableV2.AttributeType.STRING },
            deletionProtection: true,
            tableName: "usersInfoTable"
        })
    }
}