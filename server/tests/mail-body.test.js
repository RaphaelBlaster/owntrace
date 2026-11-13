import { describe, expect, it } from 'vitest'
import { canReadMailBody, collectMimeText, htmlToText } from '../src/services/mail-body.service.js'
import { GMAIL_BODY_SCOPE } from '../src/config/google.js'

describe('mail body access', () => {
  it('requires an explicit body grant and an active connection', () => {
    expect(canReadMailBody('gmail', { status: 'CONNECTED', scopes: [GMAIL_BODY_SCOPE] })).toBe(true)
    expect(canReadMailBody('gmail', { status: 'CONNECTED', scopes: [] })).toBe(false)
    expect(canReadMailBody('outlook', { status: 'SYNCING', scopes: ['Mail.ReadBasic'] })).toBe(false)
    expect(canReadMailBody('outlook', { status: 'ERROR', scopes: ['Mail.Read'] })).toBe(false)
  })

  it('strips executable HTML content and returns bounded plain text', () => {
    expect(htmlToText('<p>Hello &amp; welcome</p><script>alert(1)</script><style>bad</style>world')).toBe('Hello & welcome\nworld')
    expect(htmlToText(`<p>${'x'.repeat(9000)}</p>`)).toHaveLength(8000)
  })

  it('prefers text/plain and excludes attachment payloads recursively', () => {
    const encoded = (value) => Buffer.from(value).toString('base64url')
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/html', body: { data: encoded('<p>fallback</p>') } },
        { filename: 'file.txt', mimeType: 'text/plain', body: { data: encoded('attachment') } },
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', body: { data: encoded('plain body') } },
          { mimeType: 'text/plain', body: { attachmentId: 'secret', data: encoded('attached body') } },
        ] },
      ],
    }
    expect(collectMimeText(payload)).toBe('plain body')
  })
})
