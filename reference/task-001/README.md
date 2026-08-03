# Task 001 preserved implementation

This directory retains the latest recovered eight-screen VOYARA HTML demonstration and its original audit harness.

- Source: `voyara-mvp-demo-july7-10.html`
- SHA-256: `dcf076419625a71676fe8029da574dfca0eb86259152c747552cb46a74f62ceb`
- DOM audit: `npm run test:legacy`
- Optional real-browser audit: `npm run test:legacy:browser`

The source is intentionally outside `public/` because it contains personal-looking fixtures and simulated commercial authority. It remains the visual comparison baseline and must not be deployed as a Production application.
