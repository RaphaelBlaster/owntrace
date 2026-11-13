import { GMAIL_METADATA_SCOPE } from '../config/google.js'

function buildGoogleCapabilities(connection) {
  const hasConnection = Boolean(connection)
  const hasGmailMetadata = Boolean(connection?.scopes?.includes(GMAIL_METADATA_SCOPE))

  return {
    confirmed: [
      {
        active: hasConnection,
        id: 'verified-google-identity',
        label: 'Verified Google identity',
        summary: hasConnection
          ? 'Google verified the connected email identity during OAuth.'
          : 'A Google identity can be confirmed only after OAuth completes.',
      },
      {
        active: hasConnection,
        id: 'oauth-connection-state',
        label: 'OAuth connection state',
        summary: hasConnection
          ? 'OwnTrace can report this connection’s stored status and granted scopes.'
          : 'No Google OAuth connection is stored for this OwnTrace user.',
      },
      {
        active: hasGmailMetadata,
        id: 'gmail-metadata-access',
        label: 'Gmail metadata access',
        summary: hasGmailMetadata
          ? 'The granted scope permits Gmail headers and labels, not message bodies.'
          : 'Gmail metadata access has not been granted.',
      },
    ],
    inferred: [
      {
        active: hasGmailMetadata,
        id: 'account-relationships',
        label: 'Account relationships',
        summary: hasGmailMetadata
          ? 'OwnTrace can infer account relationships from minimized Gmail metadata evidence.'
          : 'Account relationships can be inferred only after a metadata scan.',
      },
    ],
    unsupported: [
      {
        active: false,
        id: 'google-connected-apps-inventory',
        label: 'Google-wide connected apps inventory',
        summary: 'OwnTrace has no supported API access to enumerate or revoke every third-party app grant in your Google Account.',
      },
    ],
  }
}

export { buildGoogleCapabilities }
