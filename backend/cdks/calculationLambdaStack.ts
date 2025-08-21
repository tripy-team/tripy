import { Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";

export class lambdaStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
  }
}
