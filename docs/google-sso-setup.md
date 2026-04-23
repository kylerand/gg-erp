# Google SSO for Cognito — Workspace-restricted setup

This walks through creating an OAuth 2.0 Client in Google Cloud Console, scoped to the `golfingarage.com` Google Workspace org, that Cognito will federate through for "Sign in with Google".

Time: ~5 min. You only need to do steps 1–6; paste the Client ID + Client Secret back and Claude takes it from there.

---

## 0. Sign in with the right account

Go to <https://console.cloud.google.com> and make sure the top-right account picker shows an `@golfingarage.com` account, **not** a personal Gmail. If you're in a personal account, switch.

This matters because "Internal" OAuth apps are only visible to users in the same Workspace org, and the org is determined by the account creating the client.

---

## 1. Select (or create) the Google Cloud project

Top-left, next to "Google Cloud", click the project picker.

- If a project already exists for Golfin Garage (e.g. "Golfin Garage", "gg-erp", "golfingarage"), select it.
- Otherwise: **New Project**
  - Name: `gg-erp-auth`
  - Organization: **golfingarage.com** ← required; if this dropdown shows "No organization", stop — your account isn't in the Workspace org and step 0 went wrong.
  - Location: leave as `golfingarage.com`
  - Click **Create**, wait ~10s for the project to be created, then select it.

---

## 2. Configure the OAuth consent screen (Internal)

Left nav: **APIs & Services → OAuth consent screen** (or go directly to <https://console.cloud.google.com/apis/credentials/consent>).

If it asks for User Type:

- **User Type: Internal** ← this is the restriction. Only `@golfingarage.com` accounts will be able to use this client. You can *only* select Internal if the project is owned by a Workspace org (from step 1).
- Click **Create**.

Fill in the consent screen (minimum required):

| Field | Value |
|---|---|
| App name | `Golfin Garage ERP` |
| User support email | `krand40@gmail.com` or your `@golfingarage.com` address |
| App logo | (skip — optional) |
| Application home page | `https://golfingarage.m4nos.com` |
| Authorized domains | add: `amazoncognito.com` and `m4nos.com` |
| Developer contact email | your email |

Click **Save and Continue**.

**Scopes** step: click **Add or Remove Scopes**, check the three basic ones:

- `.../auth/userinfo.email`
- `.../auth/userinfo.profile`
- `openid`

Click **Update → Save and Continue**.

**Summary** step: click **Back to Dashboard**.

---

## 3. Create the OAuth 2.0 Client ID

Left nav: **APIs & Services → Credentials** (<https://console.cloud.google.com/apis/credentials>).

Click **+ Create Credentials → OAuth client ID**.

| Field | Value |
|---|---|
| Application type | **Web application** |
| Name | `gg-erp-cognito-dev` |

### Authorized JavaScript origins

Click **+ Add URI** and add:

```
https://dev-auth.auth.us-east-2.amazoncognito.com
```

(When prod Cognito is stood up as its own pool later, you'd add `https://prod-auth.auth.us-east-2.amazoncognito.com` too — not needed today.)

### Authorized redirect URIs

Click **+ Add URI** and add exactly:

```
https://dev-auth.auth.us-east-2.amazoncognito.com/oauth2/idpresponse
```

This path `/oauth2/idpresponse` is Cognito-specific — don't change it. If you have a typo here, Google returns `redirect_uri_mismatch` and auth fails silently.

Click **Create**.

---

## 4. Copy the Client ID and Client Secret

A modal pops up showing:

- **Client ID**: `XXXXXXXXXXXX-XXXXXXXXXXXXXXXXXXXX.apps.googleusercontent.com`
- **Client secret**: `GOCSPX-XXXXXXXXXXXXXXXXXXXXXXXXXXX`

Copy both. Paste them back into the chat with Claude — they'll be stored as GH Actions secrets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and pushed onto the Cognito identity provider.

If you close the modal without copying the secret: go back to Credentials, click the client, and **Reset client secret**.

---

## 5. (Sanity check) Confirm the client is Internal

Back on **APIs & Services → OAuth consent screen**, verify:

- **User type: Internal**
- **Publishing status: In production** (Internal apps skip verification)

If it shows "External" anywhere, stop — the client is reachable by anyone with a Google account, not just Workspace members. Re-do step 2 with User Type = Internal.

---

## 6. (Optional, recommended) Enable the People API

Left nav: **APIs & Services → Library** → search "People API" → **Enable**.

Cognito works without it because the OAuth userinfo endpoint returns email/name, but enabling it makes the consent grant faster and lets Cognito pull the profile picture if you want it later.

---

## What Claude does after you paste the credentials

1. Stores `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as GitHub Actions secrets.
2. Adds `aws_cognito_identity_provider.google` to the Cognito terraform module with `hd=golfingarage.com` in `authorize_request_extra_params`.
3. Updates both Cognito app clients to include `Google` in `supported_identity_providers`, enables the code OAuth flow, and wires callback URLs for `https://golfingarage.m4nos.com/auth/callback` + floor-tech equivalent + `http://localhost:*/auth/callback`.
4. Adds a `PreSignUp_ExternalProvider` Lambda trigger that hard-rejects any email not ending in `@golfingarage.com`. Belt-and-suspenders — even if the Google side is misconfigured, Cognito refuses to create the user.
5. Adds a "Sign in with Google" button to both the web and floor-tech `/auth` pages, calling Amplify's `signInWithRedirect({ provider: 'Google' })`.
6. Runs targeted `terraform apply` to dev; tests the round-trip with a `@golfingarage.com` account.

---

## Troubleshooting reference

| Error | Likely cause |
|---|---|
| `redirect_uri_mismatch` (Google side) | Redirect URI typo. Must be exactly `https://dev-auth.auth.us-east-2.amazoncognito.com/oauth2/idpresponse` — no trailing slash, https only. |
| `invalid_client` (Google side) | Client ID wrong in Cognito, or client was disabled in GCP. |
| Google shows "This account can't be used to sign in" | User is not in the `golfingarage.com` Workspace org. Working as intended. |
| Cognito shows "Already found an entry for username `Google_12345...`" | A user with that Google `sub` exists. Delete from Cognito user pool or re-link attributes. |
| Works on `dev-auth` but fails when you add a prod domain | Prod Cognito pool needs its own Google OAuth client (separate Client ID). Don't reuse dev credentials in prod. |

---

## References

- AWS docs: [Add Google as a social identity provider](https://docs.aws.amazon.com/cognito/latest/developerguide/google.html)
- Google docs: [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- Google docs: [Restrict users to a specific domain with the `hd` parameter](https://developers.google.com/identity/protocols/oauth2/openid-connect#hd-param)
