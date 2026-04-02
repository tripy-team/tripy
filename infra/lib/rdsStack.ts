import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export class RdsStack extends Stack {
    readonly vpc: ec2.Vpc;
    readonly cluster: rds.DatabaseCluster;
    readonly secret: secretsmanager.ISecret;
    readonly securityGroup: ec2.SecurityGroup;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        const isProd = this.node.tryGetContext("env") === "prod";

        // VPC — 2 AZs, public + isolated subnets, no NAT gateway to save cost
        this.vpc = new ec2.Vpc(this, "TripyVpc", {
            vpcName: "tripy-vpc",
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: [
                {
                    name: "public",
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: "isolated",
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24,
                },
            ],
        });

        // Security group for the Aurora cluster
        this.securityGroup = new ec2.SecurityGroup(this, "TripyDbSg", {
            vpc: this.vpc,
            securityGroupName: "tripy-db-sg",
            description: "Allow PostgreSQL access to Tripy Aurora cluster",
            allowAllOutbound: true,
        });

        // Allow inbound from anywhere on port 5432 (for dev/Amplify Lambda access)
        // In production, restrict this to specific CIDR ranges or security groups
        this.securityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(5432),
            "Allow PostgreSQL from anywhere (tighten for prod)",
        );

        // Aurora Serverless v2 PostgreSQL cluster
        this.cluster = new rds.DatabaseCluster(this, "TripyAuroraCluster", {
            clusterIdentifier: "tripy-aurora",
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_16_4,
            }),
            defaultDatabaseName: "tripy",
            credentials: rds.Credentials.fromGeneratedSecret("tripy_admin", {
                secretName: "tripy/db-credentials",
            }),
            serverlessV2MinCapacity: 0.5,
            serverlessV2MaxCapacity: isProd ? 8 : 2,
            writer: rds.ClusterInstance.serverlessV2("writer", {
                publiclyAccessible: true,
            }),
            vpc: this.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [this.securityGroup],
            storageEncrypted: true,
            backup: {
                retention: Duration.days(isProd ? 14 : 1),
            },
            removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        });

        this.secret = this.cluster.secret!;

        // ─── Outputs ─────────────────────────────────────────
        new CfnOutput(this, "ClusterEndpoint", {
            value: this.cluster.clusterEndpoint.hostname,
            description: "Aurora cluster writer endpoint",
            exportName: "TripyDbEndpoint",
        });

        new CfnOutput(this, "ClusterPort", {
            value: this.cluster.clusterEndpoint.port.toString(),
            description: "Aurora cluster port",
            exportName: "TripyDbPort",
        });

        new CfnOutput(this, "DatabaseName", {
            value: "tripy",
            description: "Default database name",
            exportName: "TripyDbName",
        });

        new CfnOutput(this, "SecretArn", {
            value: this.secret.secretArn,
            description: "Secrets Manager ARN for DB credentials",
            exportName: "TripyDbSecretArn",
        });

        new CfnOutput(this, "VpcId", {
            value: this.vpc.vpcId,
            description: "VPC ID",
            exportName: "TripyVpcId",
        });
    }
}
