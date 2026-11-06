// Deploy-time helper: creates the key pair CloudFront uses to check signed links to photos and videos.
// The private key is kept as an encrypted SSM parameter (free); only the public key goes to CloudFront.
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { DeleteParameterCommand, GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

interface Event {
  RequestType: 'Create' | 'Update' | 'Delete';
  PhysicalResourceId?: string;
  ResourceProperties: { ParameterName: string };
}

export async function handler(event: Event) {
  const name = event.ResourceProperties.ParameterName;
  if (event.RequestType === 'Delete') {
    await ssm.send(new DeleteParameterCommand({ Name: name })).catch(() => undefined);
    return { PhysicalResourceId: name };
  }
  // Keep an existing key, so links already handed out stay valid across deploys.
  const existing = await ssm
    .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    .then((r) => r.Parameter?.Value)
    .catch(() => undefined);
  let privateKey = existing;
  if (!privateKey) {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    await ssm.send(
      new PutParameterCommand({
        Name: name,
        Value: privateKey,
        Type: 'SecureString',
        Overwrite: true,
        Description: 'Family Archive: signs CloudFront links to photos and videos',
      }),
    );
  }
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return { PhysicalResourceId: name, Data: { PublicKey: publicKey } };
}
