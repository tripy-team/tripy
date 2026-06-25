import { Stack, StackProps, CfnOutput, Aws } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rum from "aws-cdk-lib/aws-rum";

export interface RumStackProps extends StackProps {
    /** Apex domain RUM is allowed to collect telemetry from. Subdomains (e.g. dev.) are included. */
    appDomain?: string;
}

/**
 * CloudWatch RUM (Real User Monitoring) for the web frontend.
 *
 * The browser SDK needs anonymous AWS credentials to call rum:PutRumEvents. Those
 * come from a Cognito **Identity Pool** that allows unauthenticated identities,
 * mapped to a guest IAM role scoped to ONLY publishing RUM events.
 *
 * The previous setup failed with "Value null at 'identityId'" because the identity
 * pool the frontend pointed at either didn't exist or didn't allow unauthenticated
 * (guest) access, so Cognito's GetId returned nothing. This stack provisions the
 * pool, the guest role, the role attachment, and the app monitor together so they
 * can't drift out of sync.
 */
export class RumStack extends Stack {
    constructor(scope: Construct, id: string, props?: RumStackProps) {
        super(scope, id, props);

        const appDomain = props?.appDomain ?? "tripshacker.com";
        const appMonitorName = "tripy-web";

        // Identity pool that issues anonymous (guest) credentials to browsers.
        const identityPool = new cognito.CfnIdentityPool(this, "TripyRumIdentityPool", {
            identityPoolName: "tripy_rum",
            allowUnauthenticatedIdentities: true, // ← the bit that was missing/disabled
        });

        // Guest role: assumable only via Cognito web-identity federation for THIS pool,
        // and only by unauthenticated identities. Grants nothing but PutRumEvents.
        const appMonitorArn = `arn:aws:rum:${Aws.REGION}:${Aws.ACCOUNT_ID}:appmonitor/${appMonitorName}`;
        const guestRole = new iam.Role(this, "TripyRumGuestRole", {
            assumedBy: new iam.FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                {
                    StringEquals: {
                        "cognito-identity.amazonaws.com:aud": identityPool.ref,
                    },
                    "ForAnyValue:StringLike": {
                        "cognito-identity.amazonaws.com:amr": "unauthenticated",
                    },
                },
                "sts:AssumeRoleWithWebIdentity",
            ),
            description: "Anonymous browser role allowed to publish CloudWatch RUM events",
        });
        guestRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ["rum:PutRumEvents"],
                resources: [appMonitorArn],
            }),
        );

        // Map the guest role to the pool's unauthenticated identities.
        new cognito.CfnIdentityPoolRoleAttachment(this, "TripyRumRoleAttachment", {
            identityPoolId: identityPool.ref,
            roles: { unauthenticated: guestRole.roleArn },
        });

        // The app monitor the browser SDK reports to, wired to the pool + guest role.
        const appMonitor = new rum.CfnAppMonitor(this, "TripyAppMonitor", {
            name: appMonitorName,
            domainList: [appDomain, `*.${appDomain}`],
            cwLogEnabled: true,
            appMonitorConfiguration: {
                allowCookies: true,
                enableXRay: false,
                sessionSampleRate: 1,
                telemetries: ["errors", "performance", "http"],
                identityPoolId: identityPool.ref,
                guestRoleArn: guestRole.roleArn,
            },
        });

        // These two values go into the frontend env as NEXT_PUBLIC_RUM_APP_MONITOR_ID
        // and NEXT_PUBLIC_RUM_IDENTITY_POOL_ID.
        new CfnOutput(this, "RUM_APP_MONITOR_ID", { value: appMonitor.attrId });
        new CfnOutput(this, "RUM_IDENTITY_POOL_ID", { value: identityPool.ref });
        new CfnOutput(this, "RUM_GUEST_ROLE_ARN", { value: guestRole.roleArn });
    }
}
