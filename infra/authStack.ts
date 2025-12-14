import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface AuthPayload {
    userId: string;
    email: string;
    provider: 'google' | 'apple' | 'email';
    providerUserId: string;
    emailVerified: boolean;

}

export class authStack extends Stack {
    readonly userpool: cognito.UserPool
    readonly userpoolClient: cognito.UserPoolClient

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props)

        this.userpool = new cognito.UserPool(this, "tripyUserpoolStack", {
            selfSignUpEnabled: true,
            userVerification: {
                emailSubject: "Embark with Tripy",
                emailBody: "Hello {username}, thank you for joining Tripy. Your one time code is {####}!",
                smsMessage: "Hello {username}, thank you for joining Tripy. Your one time code is {####}!"
            },
            signInAliases: {
                username: true,
                email: true,
                phone: true
            },
            autoVerify: {
                email: true,
                phone: true
            },
            signInPolicy: {
                allowedFirstAuthFactors: {
                    password: true
                },
            },
            passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED,
            standardAttributes: {
                email: {
                    mutable: true,
                    required: true
                },
                phoneNumber: {
                    mutable: true,
                    required: true
                },
                givenName: {
                    mutable: true,
                    required: true
                },
                familyName: {
                    mutable: true,
                    required: true
                }
            },
            customAttributes: {

            },
            keepOriginal: {
                email: true,
                phone: true,
            },
            mfa: cognito.Mfa.REQUIRED,
            mfaSecondFactor: {
                sms: true,
                otp: true,
                email: true
            },
            passwordPolicy: {
                minLength: 12,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
                tempPasswordValidity: Duration.days(1),
            },
            accountRecovery: cognito.AccountRecovery.PHONE_AND_EMAIL,
            standardThreatProtectionMode: cognito.StandardThreatProtectionMode.FULL_FUNCTION,
            email: cognito.UserPoolEmail.withSES({
                fromEmail: 'noreply@traveltripy.com',
                fromName: 'tripy',
                replyTo: 'support@traveltripy.com',
                sesRegion: "us-east-1"
            }),
            deviceTracking: {
                challengeRequiredOnNewDevice: true,
                deviceOnlyRememberedOnUserPrompt: true,
            },
            deletionProtection: true,
            userPoolName: "tripyUserPool"
        })

        this.userpoolClient = new cognito.UserPoolClient(this, "tripyUserpoolClient", {
            userPool: this.userpool
        })
    }
}