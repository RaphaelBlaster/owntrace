# Supplied TRACE kit integration

Source: user-supplied `TRACE-prototype.zip`, `TRACE-prototype/trace-chat-prototype/`.

The glow shader (`pro-glow.js`), font, `stars.js`, recovered composer HTML/CSS, appearance CSS, icon geometry and source notices are copied from the ZIP. `TraceGlow` and `TraceComposer` host the supplied custom elements in React and connect their existing events/state methods. They do not replace the kit with recreated visual components or an iframe.

Mechanical production adaptations to `chatgpt-pill.js`:

- Import the original recovered HTML/CSS as Vite raw assets rather than fetching a runtime directory, so the production build can resolve them.
- Import the original appearance CSS as a raw asset and install it once, excluding preview polling as requested. The styling bytes remain the supplied file.

The React adapter wires `composer-submit`, `composer-change`, `composer-stop`, `setDraft`, `setBusy` and `focusInput` to the authenticated assistant. The original plus control opens the live OwnTrace workspace; metadata-only attachment selection is disabled rather than pretending to analyze files. The supplied response-detail control is connected to the backend answer-detail preference. Dictation remains the supplied browser-supported implementation.

Standalone fake replies, local conversation store, debug controls, preview reload and offline worker are not imported. Mongo owns authenticated history. The same live chat view is partitioned when a native OwnTrace page opens beside it. Original font provenance and Lucide notices are retained.
