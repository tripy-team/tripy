import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";

export class s3Stack extends Stack {
    readonly bucket: s3.Bucket
    constructor(scope: Construct, id: string, name: string, props?: StackProps) {
        super(scope, id, props)
        this.bucket = new s3.Bucket(this, id, {
            bucketName: name,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        })
    }
}