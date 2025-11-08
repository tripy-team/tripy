import {Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";

export class authStack extends Stack{
    readonly userpool: cognito.UserPool
    readonly userpoolClient: cognito.UserPoolClient

    constructor(scope:Construct, id: string, props?:StackProps){
        super(scope, id, props)

        this.userpool= new cognito.UserPool(this, "tripyUsers")
        this.userpoolClient=new cognito.UserPoolClient()
    }
}