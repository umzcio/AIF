# UM_Standards — IT Staff & Administrators

Reference file for IT staff, systems administrators, and technology leadership at the
University of Montana. Load this file when the user's context involves infrastructure,
security, systems management, or technology operations.

---

## Data Handling for IT Contexts

### What Requires Extra Care

- **Banner and ERP data**: Student, HR, and financial records in Banner are FERPA/HIPAA
  protected. Do not paste raw exports or queries containing identifiable records into Claude.
  Use anonymized or aggregated examples when seeking help with queries or reports.
- **Network and access logs**: Logs containing user identities, IP addresses, or behavioral
  data should be scrubbed before sharing with Claude.
- **Incident data**: Security incidents involving PII must be handled per UM's incident
  response policy. Claude can assist with technical analysis but should not retain or
  process identifiable victim/affected party data.
- **Vendor contracts and licensing**: Confidential pricing, negotiation strategies, and
  vendor SLA details should not be shared with Claude in ways that could create disclosure risk.

### Safe Uses of Claude for IT

- Drafting documentation, runbooks, and knowledge base articles (scrubbed of live credentials)
- Troubleshooting scripts, code review, and automation development
- Policy drafting and communication templates
- Training material development
- Summarizing technical concepts for non-technical audiences
- Grant narrative support for NSF CC*, Internet2, or similar infrastructure grants

---

## Security Standards

- **Never enter credentials into Claude**: API keys, passwords, service account credentials,
  MFA codes, or certificate private keys. If a task requires credential context, use
  placeholder values (e.g., `YOUR_API_KEY_HERE`).
- **Vulnerability data**: Treat CVE details, active vulnerability scan results, and
  penetration test findings as sensitive. Share only at the level of detail needed for
  the task.
- **Change management**: Claude can help draft change requests and impact assessments.
  Final approval must follow UM's established change management process — Claude output
  is a draft, not an authorized change record.

---

## AI Disclosure for IT-Generated Content

- Technical documentation and runbooks: Disclosure optional for internal use
- Communications to campus stakeholders about systems or outages: Disclose AI assistance
- Policy documents (AUP, security policies, IT governance): Recommend disclosure and
  legal/compliance review before publication
- Vendor communications: Human review required before sending

---

## Escalation — When to Loop in Others

| Situation | Who to involve |
|---|---|
| Potential data breach or FERPA incident | CIO, Privacy Officer, Legal |
| Tribal college data or system access questions | CIO + TCU partner contact |
| Vendor contract interpretation | Procurement / Legal |
| NSF CC* grant compliance questions | Research Office + PI |
| Active security incident | Incident response team per UM IR policy |

---

## Accessibility — IT-Specific Guidance (WCAG 2.1 AA)

IT staff play a key role in ensuring UM's technology infrastructure is accessible by default.

- **Procurement**: When evaluating vendors or software, accessibility (VPAT/WCAG 2.1 AA
  compliance) must be part of the evaluation criteria. Ask Claude to help draft accessibility
  requirements for RFPs and vendor assessments.
- **Web and application development**: All UM-managed web properties and applications must
  target WCAG 2.1 AA. When Claude assists with front-end code, it will default to accessible
  patterns (semantic HTML, ARIA labels, keyboard navigation, sufficient contrast).
- **Documentation and knowledge bases**: IT documentation published to staff or students
  must use proper heading structure, descriptive link text, and alt text for screenshots.
- **Email and communications**: Avoid image-only communications. Ensure HTML emails have
  plain-text equivalents.
- **Testing**: Recommend automated accessibility testing (e.g., axe, WAVE) as part of
  deployment checklists. Flag when Claude-assisted content has not been accessibility-tested.

**Escalation**: ADA/504 Coordinator for formal compliance review of high-risk systems.

---

## Cybersecurity — Expanded NIST CSF Guidance for IT Staff

IT staff are the primary owners of UM's NIST CSF implementation. Claude can assist across
all five functions:

### Identify
- Asset inventory documentation, data classification schemas, risk register maintenance
- Identifying data types and sensitivity levels in system design discussions
- Third-party and vendor risk documentation

### Protect
- Access control policy drafting (least privilege, role-based access, MFA requirements)
- Security configuration baselines and hardening guides
- Security awareness training content
- Encryption standards documentation (data at rest and in transit)
- **Never**: Bypass or circumvent access controls, even in test/dev environments, without
  proper change management authorization

### Detect
- Log management documentation and SIEM query assistance
- Anomaly detection runbooks
- Alerting threshold documentation

### Respond
- Incident response plan drafting and tabletop scenario development
- Communication templates for security incidents (internal, affected parties, regulatory)
- Post-incident report structure and lessons-learned facilitation
- **Note**: Active incident communications involving PII or affected individuals require
  legal/privacy officer review before sending

### Recover
- Business continuity and disaster recovery plan documentation
- Recovery procedure runbooks
- After-action report templates

---

## Relevant UM Contacts & Resources

- **CIO**: Zach Rossmiller (zach.rossmiller@umontana.edu)
- **IT Security**: UM IT Security team
- **Privacy/FERPA questions**: Registrar's Office
- **Research data questions**: Office of Research and Creative Scholarship
- **NSF CC* grant compliance**: Coordinate with PI and Research Office
