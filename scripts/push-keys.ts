// Prints a new key pair for phone notifications (NEXUS_PUSH_PUBLIC_KEY / NEXUS_PUSH_PRIVATE_KEY). Run once per environment
// and paste the values into that environment's secret settings. Never commit them.
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
void publicKey;
console.log(`NEXUS_PUSH_PUBLIC_KEY=${point.toString("base64url")}\nNEXUS_PUSH_PRIVATE_KEY=${jwk.d}`);
