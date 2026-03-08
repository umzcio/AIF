import * as jose from "jose";

const JWT_SECRET_RAW = process.env.JWT_SECRET || "aif-dev-secret-change-in-prod";
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";
const ISSUER = "aif-portal";
const AUDIENCE = "aif-users";

let secretKey;
function getSecret() {
  if (!secretKey) secretKey = new TextEncoder().encode(JWT_SECRET_RAW);
  return secretKey;
}

export async function generateToken(user) {
  return new jose.SignJWT({
    netid: user.netid,
    role: user.role,
    userId: user.id,
    displayName: user.displayName || user.display_name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

export async function verifyToken(token) {
  const { payload } = await jose.jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return payload;
}
