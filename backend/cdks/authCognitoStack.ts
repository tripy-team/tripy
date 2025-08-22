import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";

export interface authCognitoStackProps extends StackProps {}

export class authCognitoStack extends Stack {
  constructor(scope: Construct, id: string, props: authCognitoStackProps) {
    super(scope, id, props);

    const requiredAndMutable = {
      required: true,
      mutable: true,
    };


    const tripyUserpool = new cognito.UserPool(this, `${id}-userpool`, {
      userPoolName: "tripy-userpool",
      signInCaseSensitive: true,

      //sign ups
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: "Welcome to Tripy!",
        emailBody:
          "Thank you for signing up for Tripy! Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
        smsMessage: "Welcome to Tripy! Your verification code is {####}",
      },
      standardAttributes: {
        fullname: requiredAndMutable,
        email: requiredAndMutable,
        phoneNumber: requiredAndMutable,
        birthdate: requiredAndMutable, //need to include above 18 functionality,
        gender: requiredAndMutable, //drop down for male, female, non-binary, prefer not to answer
      },

      //sign ins
      signInAliases: {
        email: true,
        phone: true,
      },
      autoVerify: {
        email: true,
        phone: true,
      },
      signInPolicy: {
        allowedFirstAuthFactors: {
          emailOtp: true,
          smsOtp: true,
          password: false,
        },
      },

      //account recovery
      accountRecovery: cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,

      //account security
      standardThreatProtectionMode:
        cognito.StandardThreatProtectionMode.FULL_FUNCTION,

      //device tracking
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: true,
      },

      //lambda triggers
      lambdaTriggers: {},
    })

    //multi source sign in
    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'Google',{
      clientId: "<insert>",
      clientSecret: "<insert>",
      userPool: tripyUserpool
    })
    const appleProvider = new cognito.UserPoolIdentityProviderApple(this, "Apple",{
      clientId: "<insert>",
      teamId: "<insert>",
      keyId: "<insert>",
      userPool: tripyUserpool
    })
    // const lambdaTriggerRole = new iam.Role(this, "lambdaTrigger", {
    //   assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    // });
    // userpool.grant(lambdaTriggerRole, "cognito-idp:AdminCreateUser");
  }
}
