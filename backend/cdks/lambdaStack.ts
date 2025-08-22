import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Duration, Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";

export class lambdaStack extends Stack{

    readonly lambdaFunction: lambda.Function

    constructor(scope: Construct, id: string, props: StackProps, code_path: string){
        super(scope, id, props)

        this.lambdaFunction = new lambda.Function(this, id, {
            functionName: id,
            code: lambda.Code.fromAsset(code_path),
            runtime: lambda.Runtime.PYTHON_3_13,
            handler: `${code_path}.index_handler`,
            timeout: Duration.minutes(15)
        })
    }
}