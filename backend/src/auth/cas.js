const CAS_BASE_URL = process.env.CAS_BASE_URL || "https://login.umt.edu/cas";
const CAS_VALIDATE_URL = `${CAS_BASE_URL}/serviceValidate`;

export async function validateTicket(ticket, serviceUrl) {
  const url = `${CAS_VALIDATE_URL}?ticket=${encodeURIComponent(ticket)}&service=${encodeURIComponent(serviceUrl)}`;
  const resp = await fetch(url);
  const xml = await resp.text();
  return parseCASXML(xml);
}

function parseCASXML(xml) {
  // CAS 2.0 success response
  const userMatch = xml.match(/<cas:user>([^<]+)<\/cas:user>/);
  if (!userMatch) {
    // CAS 1.0 fallback
    const lines = xml.trim().split("\n");
    if (lines[0] === "yes" && lines[1]) {
      return { netid: lines[1].trim(), displayName: null };
    }
    return null;
  }

  const netid = userMatch[1].trim();
  const nameMatch = xml.match(/<cas:commonName>([^<]+)<\/cas:commonName>/) ||
                    xml.match(/<cas:displayName>([^<]+)<\/cas:displayName>/);
  const displayName = nameMatch ? nameMatch[1].trim() : null;

  return { netid, displayName };
}
