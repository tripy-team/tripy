# Useful AWS CLI Commands

## CloudFront Distributions

### List All CloudFront Distributions

```bash
aws cloudfront list-distributions
```

### List Only Distribution IDs and Domain Names (Cleaner Output)

```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[*].[Id,DomainName,Status]" \
  --output table
```

### List Distribution IDs Only

```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[*].Id" \
  --output text
```

### Get Details of a Specific Distribution

```bash
aws cloudfront get-distribution --id E1234567890
```

### List All Origins for All Distributions

```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[*].[Id,Origins.Items[*].DomainName]" \
  --output table
```

## S3 Buckets

### List All S3 Buckets

```bash
aws s3 ls
```

### List Objects in a Bucket

```bash
aws s3 ls s3://tripy-city-images/
```

### List Objects with Details

```bash
aws s3 ls s3://tripy-city-images/ --recursive --human-readable --summarize
```

## DynamoDB Tables

### List All DynamoDB Tables

```bash
aws dynamodb list-tables
```

### Get Table Details

```bash
aws dynamodb describe-table --table-name tripy-city-images
```

### List Items in a Table

```bash
aws dynamodb scan --table-name tripy-city-images
```

### Get Specific Item

```bash
aws dynamodb get-item \
  --table-name tripy-city-images \
  --key '{"city": {"S": "paris"}}'
```

## IAM Roles

### List IAM Roles

```bash
aws iam list-roles
```

### Get Role Details

```bash
aws iam get-role --role-name TripyAppRunnerRole
```

### List Role Policies

```bash
aws iam list-attached-role-policies --role-name TripyAppRunnerRole
```

## App Runner

### List App Runner Services

```bash
aws apprunner list-services
```

### Get Service Details

```bash
aws apprunner describe-service --service-arn arn:aws:apprunner:...
```

### List Service Environment Variables

```bash
aws apprunner describe-service \
  --service-arn arn:aws:apprunner:... \
  --query "Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables" \
  --output json
```

## Useful One-Liners

### Find CloudFront Distribution by S3 Bucket

```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[?contains(DomainName, 'tripy-city-images')]].[Id,DomainName]" \
  --output table
```

### Check if S3 Bucket Exists

```bash
aws s3 ls s3://tripy-city-images 2>&1 | grep -q "NoSuchBucket" && echo "Bucket does not exist" || echo "Bucket exists"
```

### Count Objects in S3 Bucket

```bash
aws s3 ls s3://tripy-city-images --recursive | wc -l
```

### Get CloudFront Distribution Status

```bash
aws cloudfront list-distributions \
  --query "DistributionList.Items[*].[Id,DomainName,Status]" \
  --output table
```
