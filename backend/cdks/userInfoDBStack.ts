import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";

export class userInfoDBStack extends Stack {
  constructor(construct: Construct, id: string, props: StackProps) {
    super(construct, id, props);

    const userTable = new dynamodb.TableV2(this, `${id}-userTable`, {
      partitionKey: {
        name: "userUUID",
        type: dynamodb.AttributeType.STRING,
      },
      encryption: dynamodb.TableEncryptionV2.dynamoOwnedKey(),
    });

    const tripsTable = new dynamodb.TableV2(this, `${id}-tripsTable`, {
      partitionKey: {
        name: "tripUUID",
        type: dynamodb.AttributeType.STRING,
      },
      encryption: dynamodb.TableEncryptionV2.dynamoOwnedKey(),
    });
  }
}
