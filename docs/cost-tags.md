# Project cost tags

The default is `project=family-photos`. It covers taggable auth and Archive resources, including storage, database, queues, functions and CDN resources. This changes cost labels only, not stored photos, permissions or app behavior.

Backend resources that support AWS tags inherit `project` from the root Amplify stack. Set `COST_TAG` in **Amplify Hosting → Hosting → Environment variables** before deployment to use a different project name. Use an app-level value shared by its branches.

On a `main` deployment, `amplify/cost-tags.ts` also tags the Hosting app identified by Amplify's `AWS_APP_ID`, in the deployment's account and region. It sets the tag when the custom resource is created or its configuration changes. Preview branches and local sandboxes only tag their own backend; they cannot change the shared Hosting app's tag.

The Hosting tagger adds a deployment-only Lambda, its execution role/policy, and a log group retaining one week of logs. Its AWS permissions allow setting only the `project` tag, to the configured value, on that one Hosting app. No app deletion or untagging is granted; deleting the backend leaves the Hosting tag intact. It uses the runtime's bundled AWS SDK and does not install packages during deployment.

## Enable billing reports

1. Merge and deploy the tagging change.
2. In **Billing and Cost Management → Cost allocation tags**, activate the user-defined `project` key once per account. New keys may take up to 24 hours to appear and another 24 hours to activate.
3. In **Cost Explorer**, group by **Tag → project**. Check both Hosting and backend costs after billing data refreshes.
4. If the tag existed historically, **Cost allocation tags → Backfill tags** can backfill activation for up to 12 months. It cannot attribute periods before resources carried the tag.

Resource tags do not attribute every account charge or shared service usage. Keep shared/untagged charges visible as Unallocated when displaying project totals. These PRs do not change the Command Center dashboard or activate billing tags.

## Cost and verification

Tags add no recurring resource fee. The deployment-only Lambda and one week of logs are expected to cost well under $0.01/month per deployment at a few deployments per month; this is an estimate, depends on deployment/log volume, and excludes existing app costs. There is no scheduled polling or additional Cost Explorer request.

CDK tests check nested resource tags, the create/update calls, the exact Hosting app ARN, restricted IAM permissions, and the absence of Hosting changes in preview/sandbox builds. Local synthesis checks CloudFormation and bundling; it does not execute the Hosting API call. After the first production deployment, verify with:

```sh
aws amplify list-tags-for-resource --resource-arn <hosting-app-arn> --region <region>
```

AWS references: [activation](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html), [historical limits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-allocation-backfill.html), [Hosting tag API](https://docs.aws.amazon.com/amplify/latest/APIReference/API_TagResource.html).
