# Public Download Verification

`OuroborosChatGPT.manifest.json` is the public download manifest for
`OuroborosChatGPT.exe`.

Required fields:

- `availability`: `disabled` or `enabled`.
- `file`: file name under `downloads/`.
- `sha256`: lowercase SHA-256 hash of the file bytes.
- `production`: `true` only for a release candidate that must pass Windows
  Authenticode verification.
- `expectedSignerSubject`: exact certificate subject expected for production
  releases.
- `expectedSignerThumbprint`: exact signing certificate thumbprint recorded by
  the protected release workflow and re-checked on Windows. Both identity fields
  must match the separately configured repository variables
  `EXPECTED_SIGNER_SUBJECT` and `EXPECTED_SIGNER_THUMBPRINT`. Enabled releases
  fail closed when either protected variable is missing.

Verification:

- `node scripts/sync-download-ui.mjs --check` requires the public button and
  localized label to match the manifest state. A signed promotion must run
  the same script without `--check` after staging a production manifest.
  This repository contains verification and deployment, not a signing or
  promotion producer.
- `node scripts/check-download-metadata.mjs` validates manifest shape, rejects
  zero or placeholder signer values, and checks that `sha256` matches the EXE.
- `.github/workflows/verify-public-download.yml` runs on Windows and fails
  production verification unless Authenticode status is `Valid`, a timestamp
  certificate is present, `signtool verify /pa /all` succeeds, and the signer
  subject and thumbprint exactly match both the manifest and protected variables.

The metadata check also rejects unmanifested `.exe` files and requires
`index.html` to link exactly once to the manifested executable. A publicly
linked executable cannot use `production: false`.

The `disabled` state is the only allowed exception: it requires null file,
hash, signer, and signer thumbprint fields, `production: false`, no `.exe` under
`downloads/`, and no executable link in `index.html`. Promotion changes the
state to `enabled` only when the signed installer and production manifest arrive
together.

GitHub Pages must use the Actions deployment source. The deploy job depends on
both metadata and Windows Authenticode verification; legacy branch deployment
would bypass this contract. Protect `main` with required checks for `Metadata
and hash check` and `Windows Authenticode release gate`, and require CODEOWNERS
review for workflow, script, download, and link changes.

The download remains disabled until it is replaced by a signed promotion
artifact. Promotion must commit the signed executable, manifest, and synchronized
`index.html` together.
