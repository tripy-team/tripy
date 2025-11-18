import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// import your stacks here
import { authStack } from '../lib/authStack';
import { dbStack } from '../lib/dbStack';
import { lambdaStack } from '../lib/lambdaStack';
import { s3Stack } from '../lib/s3Stack';

const app = new cdk.App();

// Instantiate each stack
new authStack(app, 'AuthStack');

new dbStack(app, 'DbStack');

new lambdaStack(app, 'LambdaStack', 'airport_filter.py');


new s3Stack(app, "imagesTableStack", "images-table")

app.synth();
