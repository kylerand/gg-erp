# DNS Setup — golfingarage.m4nos.com

## Overview

Custom domain setup for the Golfin Garage ERP apps using Cloudflare DNS → AWS Amplify.

| App | URL | Status |
|-----|-----|--------|
| **Web Dashboard** | `golfingarage.m4nos.com` | ⏳ Pending DNS |
| **Floor Tech** | `floor.golfingarage.m4nos.com` | ⏳ Pending DNS |
| **API** | `api.golfingarage.m4nos.com` *(future)* | Not yet configured |

---

## Cloudflare DNS Records to Add

Go to **Cloudflare Dashboard → m4nos.com → DNS → Records** and add these 3 CNAME records.

> ⚠️ **Important**: All records must have **Proxy status: DNS only** (gray cloud icon, NOT orange). Amplify manages its own SSL and CDN — Cloudflare proxy will interfere with certificate validation.

### 1. SSL Certificate Verification (required first)

| Field | Value |
|-------|-------|
| **Type** | `CNAME` |
| **Name** | `_707f771b221095c243f7bb9ac516c849.golfingarage` |
| **Target** | `_4919cb2a5e50e31837d75b49afdc824c.jkddzztszm.acm-validations.aws.` |
| **Proxy** | **DNS only** (gray cloud) |
| **TTL** | Auto |

### 2. Web Dashboard

| Field | Value |
|-------|-------|
| **Type** | `CNAME` |
| **Name** | `golfingarage` |
| **Target** | `d33j7t9sw1i5eq.cloudfront.net` |
| **Proxy** | **DNS only** (gray cloud) |
| **TTL** | Auto |

### 3. Floor Tech App

| Field | Value |
|-------|-------|
| **Type** | `CNAME` |
| **Name** | `floor.golfingarage` |
| **Target** | `d2w4155qwx6ght.cloudfront.net` |
| **Proxy** | **DNS only** (gray cloud) |
| **TTL** | Auto |

---

## Verification

After adding the records, Amplify will automatically:
1. Validate the ACM certificate (via record #1) — takes 5–30 minutes
2. Activate the custom domains — takes a few more minutes after cert validation

Check status:
```bash
# Web dashboard
aws amplify get-domain-association --app-id d3uqocx9zh47h5 \
  --domain-name golfingarage.m4nos.com --region us-east-2 \
  --query 'domainAssociation.domainStatus'

# Floor tech
aws amplify get-domain-association --app-id d2mjs5v5khxca4 \
  --domain-name golfingarage.m4nos.com --region us-east-2 \
  --query 'domainAssociation.domainStatus'
```

Expected progression: `PENDING_VERIFICATION` → `IN_PROGRESS` → `AVAILABLE`

---

## After DNS Is Active

### Update Cognito Callback URLs
Add the new domains to the Cognito app client allowed callback/logout URLs:
- `https://golfingarage.m4nos.com/auth/callback`
- `https://golfingarage.m4nos.com`
- `https://floor.golfingarage.m4nos.com/auth/callback`
- `https://floor.golfingarage.m4nos.com`

### Update Amplify Environment Variables
Update `NEXT_PUBLIC_APP_URL` in both Amplify apps to use the new domains.

### (Future) API Custom Domain
To add `api.golfingarage.m4nos.com` for the API Gateway:
1. Create an ACM certificate in us-east-2 for `api.golfingarage.m4nos.com`
2. Create API Gateway custom domain mapping
3. Add CNAME in Cloudflare pointing to the API Gateway domain
