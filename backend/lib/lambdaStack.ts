import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from 'path';

export class lambdaStack extends Stack {
    readonly fn: lambda.Function
    constructor(scope: Construct, id: string, functionName: string, props?: StackProps) {
        super(scope, id, props)

        this.fn = new lambda.Function(this, id, {
            code: lambda.Code.fromAsset(path.join(__dirname, '../bin')),
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "index.handler",
            timeout: Duration.minutes(15)
        })
    }
}