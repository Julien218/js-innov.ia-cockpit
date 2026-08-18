# Pixelium Player Android signing

The pilot release is signed in GitHub Actions with repository-level Actions secrets.

Required secrets:

- `PIXELIUM_KEYSTORE_B64`
- `PIXELIUM_KEYSTORE_PASSWORD`

Optional overrides (the Gradle configuration has safe defaults):

- `PIXELIUM_KEY_ALIAS` defaults to `pixelium-release`
- `PIXELIUM_KEY_PASSWORD` defaults to the keystore password

Expected permanent release certificate SHA-256:

`8F:ED:74:01:40:24:62:9C:AA:1D:25:32:64:E8:94:E6:27:DC:1B:96:CE:1A:DD:75:D4:EE:8D:AD:87:F8:9C:F9`

The legacy 0.3 pilot was signed with an unrecoverable different certificate. Therefore the first migration to the permanent release identity requires one uninstall/reinstall. After that, future releases signed by this same permanent identity can update in place.

Never commit the keystore, its Base64 representation, or passwords to the repository.
