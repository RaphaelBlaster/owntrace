import { Link } from 'react-router-dom'
import './legal.css'

const policies = {
  privacy: {
    eyebrow: 'Privacy notice',
    title: 'Privacy Policy',
    summary: 'How the OwnTrace early-development web application handles personal information.',
    sections: [
      ['What OwnTrace processes', [
        'Account details you provide, including your name, email address, and password hash.',
        'Google account connection details and encrypted OAuth tokens when you choose to connect Gmail.',
        'Minimized Gmail metadata signals derived from selected headers. OwnTrace does not request or store email bodies, snippets, attachments, or raw MIME content.',
        'Derived account, subscription, security, exposure, privacy-request, and notification records created to provide the product.',
      ]],
      ['How information is used', [
        'To authenticate you, operate the dashboard, discover likely accounts and subscriptions, present explainable privacy signals, and support account deletion.',
        'OwnTrace does not sell personal information or use Gmail-derived data for advertising.',
      ]],
      ['External services', [
        'Google supplies identity and Gmail metadata only after your explicit OAuth consent. OwnTrace requests openid, email, and gmail.metadata.',
        'A breach check sends your OwnTrace account email to XposedOrNot only after you separately confirm that check. OwnTrace stores minimized breach names and check timestamps, not the provider response or submitted email copy.',
      ]],
      ['Retention and deletion', [
        'Data is retained while your OwnTrace account is active or as needed to operate the early-development service.',
        'Disconnecting Gmail revokes access when Google is reachable and removes the local connection and Gmail-derived records.',
        'Deleting your OwnTrace account removes the active user profile and user-scoped application records. Production backup-erasure periods must be published before a public launch.',
      ]],
      ['Security and your choices', [
        'OwnTrace uses httpOnly session cookies, encrypted provider tokens, minimized stored metadata, authenticated user-scoped APIs, and bounded processing. No internet service can promise absolute security.',
        'You can choose not to connect Gmail, decline breach checks, disconnect Google, or delete your OwnTrace account.',
      ]],
      ['Contact and changes', [
        'Until a dedicated private support channel is published, use the project repository for general questions and do not post personal information, credentials, tokens, or private account details in a public issue.',
        'Material policy changes should be dated and presented before they take effect.',
      ]],
    ],
  },
  terms: {
    eyebrow: 'Service terms',
    title: 'Terms of Service',
    summary: 'Conditions for using the OwnTrace early-development web application.',
    sections: [
      ['Early-development service', [
        'OwnTrace is an early-development privacy tool. Features, integrations, availability, and data formats may change before a public production release.',
        'Detections, confidence scores, estimated renewals, breach information, and privacy-health results are informational signals, not legal, financial, security-audit, or professional advice.',
      ]],
      ['Your responsibilities', [
        'Provide accurate registration information, protect your credentials, and use only Google and email accounts you are authorized to access.',
        'Do not misuse the service, probe other users’ data, interfere with availability, automate abusive traffic, or upload or submit unlawful content.',
      ]],
      ['Third-party services', [
        'Google and XposedOrNot operate under their own terms and availability. OwnTrace does not control their systems or guarantee that their results are complete or uninterrupted.',
        'OwnTrace does not currently send privacy requests to third parties; it only helps you track them manually.',
      ]],
      ['Availability and warranties', [
        'The early-development service is provided on an as-available basis without a promise of uninterrupted operation or complete detection.',
        'Do not rely on OwnTrace as the only record of your accounts, subscriptions, breaches, or privacy requests.',
      ]],
      ['Suspension and termination', [
        'Access may be limited to protect users, integrations, or infrastructure from abuse. You may stop using OwnTrace and delete your account through Settings.',
      ]],
      ['Changes and contact', [
        'These draft terms must receive owner and legal review before public production launch. Changes should be dated and communicated appropriately.',
        'Use the project repository for general questions, but never publish personal information or credentials there.',
      ]],
    ],
  },
}

function LegalPage({ type }) {
  const policy = policies[type]
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Link aria-label="OwnTrace home" className="legal-brand" to="/">OwnTrace</Link>
        <nav aria-label="Legal documents">
          <Link to="/privacy-policy">Privacy Policy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </header>
      <main className="legal-main">
        <header className="legal-intro">
          <p>{policy.eyebrow}</p>
          <h1>{policy.title}</h1>
          <span>{policy.summary}</span>
          <small>Draft for owner and legal review · Last updated 24 August 2026</small>
        </header>
        {policy.sections.map(([title, paragraphs]) => (
          <section key={title}>
            <h2>{title}</h2>
            {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <aside aria-label="Release notice">
          These documents accurately describe the current repository, but they are not a substitute for legal review before a public launch.
        </aside>
        <Link className="legal-back" to="/">Back to OwnTrace</Link>
      </main>
    </div>
  )
}

export default LegalPage
