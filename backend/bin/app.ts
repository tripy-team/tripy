import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// import your stacks here
import { authStack } from '../lib/authStack';
import { dbStack } from '../lib/dbStack';
import { lambdaStack } from '../lib/lambdaStack';

const app = new cdk.App();

// Instantiate each stack
new authStack(app, 'AuthStack');

new dbStack(app, 'DbStack');

new lambdaStack(app, 'LambdaStack', 'airport_filter.py');

app.synth();
