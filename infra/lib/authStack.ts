import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class AuthStack extends Stack {
    readonly userPool: cognito.UserPool;
    readonly userPoolClient: cognito.UserPoolClient;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const customMessageFn = new lambda.Function(this, "CognitoCustomMessage", {
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "index.handler",
            code: lambda.Code.fromAsset(
                path.join(__dirname, "lambdas", "custom-message"),
            ),
            environment: {
                FRONTEND_URL: process.env.FRONTEND_URL || "https://tripy.app",
            },
            timeout: Duration.seconds(5),
            memorySize: 128,
        });

        this.userPool = new cognito.UserPool(this, "TripyUserPool", {
            userPoolName: "tripy-user-pool",
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            standardAttributes: {
                email: { required: true, mutable: true },
            },
            passwordPolicy: {
                minLength: 8,
                requireDigits: true,
                requireLowercase: true,
                requireUppercase: false,
                requireSymbols: false,
                tempPasswordValidity: Duration.days(7),
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            lambdaTriggers: {
                customMessage: customMessageFn,
            },
        });

        this.userPoolClient = new cognito.UserPoolClient(this, "TripyUserPoolClient", {
            userPool: this.userPool,
            userPoolClientName: "tripy-web-client",
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            generateSecret: false,
        });

        new CfnOutput(this, "USER_POOL_ID", { value: this.userPool.userPoolId });
        new CfnOutput(this, "USER_POOL_CLIENT_ID", { value: this.userPoolClient.userPoolClientId });
    }
}
