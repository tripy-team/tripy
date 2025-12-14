import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// import your stacks here
import { authStack } from '../lib/authStack';
import { dbStack } from '../lib/dbStack';
import { lambdaStack } from '../lib/lambdaStack';
import { s3Stack } from '../lib/s3Stack';

console.log("Deploying stacks...");

const app = new cdk.App();

// Instantiate each stack
new authStack(app, 'AuthStack');

new dbStack(app, 'DbStack');

new lambdaStack(app, 'LambdaStack', 'airport_filter');

new s3Stack(app, "imagesTableStack", "images-table")

app.synth();
