# X (Twitter) Developer App Setup Guide

This guide walks you through creating and configuring an X (formerly Twitter) Developer application to enable X posting in LinkX.

## Prerequisites

- An X (Twitter) account
- A phone number verified on your X account (required for developer access)
- For Free tier: Basic account is sufficient
- For Basic/Pro tier: Payment method for subscription

## Step 1: Create an X Developer Account

1. Go to the [X Developer Portal](https://developer.x.com/)
2. Click **Sign up** or **Sign in** with your X account
3. Complete the developer agreement and submit your use case description
4. Wait for approval (usually instant for Free tier)

## Step 2: Create a Project and App

After your developer account is approved:

1. Navigate to the **Developer Portal Dashboard**
2. Click **+ Create Project**
3. Fill in the project details:

| Field | Description | Example |
|-------|-------------|---------|
| **Project name** | Your project name | `LinkX` |
| **Use case** | Select your primary use case | `Making a bot` or `Building tools for X users` |
| **Project description** | Brief description | `Social media scheduling tool` |

4. Click **Next** to create an App within the project
5. Fill in the App details:

| Field | Description | Example |
|-------|-------------|---------|
| **App name** | Your application name (must be unique) | `LinkX-Production` |
| **App environment** | Development or Production | `Production` |

6. Click **Complete** to create your app

## Step 3: Configure OAuth 2.0 Settings

After creating your app:

1. Go to your App's **Settings** tab
2. Scroll to **User authentication settings** and click **Set up**
3. Configure the following:

### App Permissions
Select the permissions your app needs:

| Permission | Description | Required for LinkX |
|------------|-------------|-------------------|
| **Read** | Read tweets and profile info | ✅ Yes |
| **Read and write** | Post tweets on behalf of users | ✅ Yes |
| **Read and write and Direct message** | Also access DMs | ❌ No |

> **For LinkX**: Select **Read and write**

### Type of App
- Select **Web App, Automated App or Bot**
- This enables OAuth 2.0 with PKCE

### App Info

| Field | Description | Example |
|-------|-------------|---------|
| **Callback URI / Redirect URL** | OAuth callback URL | See below |
| **Website URL** | Your app's website | `https://yourapp.com` |

#### Redirect URLs (OAuth callback URLs):
```
# Development
http://localhost:8000/api/v1/auth/x/callback

# Production
https://yourdomain.com/api/v1/auth/x/callback
```

> **Note**: Unlike LinkedIn, X allows `http://localhost` for development.

4. Click **Save** to apply settings

## Step 4: Get Your API Keys

1. Go to your App's **Keys and tokens** tab
2. Note down the following credentials:

| Credential | Description | Where to find |
|------------|-------------|---------------|
| **Client ID** | OAuth 2.0 Client ID | Under "OAuth 2.0 Client ID and Client Secret" |
| **Client Secret** | OAuth 2.0 Client Secret | Click "Regenerate" to reveal |

> **Important**:
> - The Client Secret is only shown once. Save it securely!
> - These are different from API Key/Secret (used for OAuth 1.0a)

## Step 5: Choose Your API Access Level

X offers different access tiers with varying capabilities:

| Feature | Free | Basic ($100/mo) | Pro ($5,000/mo) |
|---------|------|-----------------|-----------------|
| **Tweet posting** | ✅ 1,500/month | ✅ 3,000/month | ✅ 300,000/month |
| **Tweet reading** | ✅ 1,500/month | ✅ 10,000/month | ✅ 1,000,000/month |
| **Users lookup** | ✅ 500/month | ✅ 10,000/month | ✅ Unlimited |
| **Media upload** | ✅ Yes | ✅ Yes | ✅ Yes |
| **OAuth 2.0** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Elevated access** | ❌ No | ✅ Yes | ✅ Yes |

> **For most LinkX users**: **Free tier** is sufficient for personal use (approximately 50 tweets/day).

### Upgrading Access Level
1. Go to [Developer Portal Products](https://developer.x.com/en/portal/products)
2. Select the tier you need
3. Complete payment setup

## Step 6: Configure LinkX Environment Variables

Add the following to your `.env` file:

```bash
# X (Twitter) OAuth 2.0 Configuration
X_CLIENT_ID=your_client_id_here
X_CLIENT_SECRET=your_client_secret_here
X_REDIRECT_URI=http://localhost:8000/api/v1/auth/x/callback

# Optional: For organization/business accounts
X_BEARER_TOKEN=your_bearer_token_here  # For app-only authentication
```

## OAuth 2.0 Scopes Reference

X uses OAuth 2.0 with PKCE. Request only the scopes you need:

| Scope | Permission | Use Case |
|-------|------------|----------|
| `tweet.read` | Read tweets | View user's timeline |
| `tweet.write` | Post tweets | Create, delete tweets |
| `users.read` | Read user profile | Get user info (name, bio, etc.) |
| `offline.access` | Refresh tokens | Long-lived sessions |
| `like.read` | Read likes | View liked tweets |
| `like.write` | Like/unlike | Interact with tweets |
| `bookmark.read` | Read bookmarks | View saved tweets |
| `bookmark.write` | Manage bookmarks | Save tweets |
| `follows.read` | Read following/followers | View connections |
| `follows.write` | Follow/unfollow | Manage connections |
| `dm.read` | Read DMs | View direct messages |
| `dm.write` | Send DMs | Send direct messages |
| `list.read` | Read lists | View lists |
| `list.write` | Manage lists | Create/edit lists |
| `space.read` | Read Spaces | View Space info |

### Required Scopes for LinkX

```
tweet.read tweet.write users.read offline.access
```

## Rate Limits

### Free Tier Limits

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| POST /2/tweets | 1,500/month | Monthly |
| GET /2/users/me | 25 requests | 24 hours |
| Media upload | 615 requests | 15 minutes |

### Basic Tier Limits

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| POST /2/tweets | 3,000/month | Monthly |
| GET /2/users/me | 250 requests | 24 hours |
| Media upload | 615 requests | 15 minutes |

### User Rate Limits (Per-User)

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| POST /2/tweets | 200 requests | 15 minutes |
| DELETE /2/tweets/:id | 50 requests | 15 minutes |
| GET /2/tweets | 900 requests | 15 minutes |

## Token Lifespans

| Token Type | Lifespan | Notes |
|------------|----------|-------|
| Access Token | 2 hours | Short-lived, must refresh |
| Refresh Token | 6 months | Only with `offline.access` scope |
| Authorization Code | 30 seconds | Very short, use immediately |

> **Important**: X access tokens expire in **2 hours** (much shorter than LinkedIn's 60 days). Implement automatic token refresh!

## PKCE Requirements

X **requires** PKCE (Proof Key for Code Exchange) for OAuth 2.0:

1. Generate a `code_verifier` (random 43-128 character string)
2. Create `code_challenge` = Base64URL(SHA256(`code_verifier`))
3. Include `code_challenge` and `code_challenge_method=S256` in authorization request
4. Include `code_verifier` in token exchange request

```python
# Example PKCE generation
import secrets
import hashlib
import base64

code_verifier = secrets.token_urlsafe(32)
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).decode().rstrip('=')
```

## Troubleshooting

### "Invalid redirect_uri"
- Ensure the redirect URI exactly matches what's configured in the Developer Portal
- Check for trailing slashes
- Verify the callback URL is added to your app settings

### "Invalid scope"
- Verify the requested scopes are allowed for your access level
- Free tier has limited scopes
- Check your app permissions match requested scopes

### "Unauthorized (401)"
- Access token may have expired (2-hour lifespan)
- Implement token refresh using refresh token
- Verify Client ID and Secret are correct

### "Forbidden (403)"
- Your app may not have the required permissions
- Check App Permissions in User Authentication Settings
- Ensure you have the correct access tier

### "Too Many Requests (429)"
- You've hit rate limits
- Check response headers for `x-rate-limit-reset`
- Implement exponential backoff
- Consider upgrading your access tier

### "code_verifier invalid"
- PKCE code_verifier doesn't match code_challenge
- Ensure you're using the same verifier used to generate the challenge
- Check Base64URL encoding (no padding)

## Security Best Practices

1. **Use PKCE** - X requires it; generate a new verifier for each auth flow
2. **Never expose Client Secret** in frontend code or URLs
3. **Store tokens encrypted** in your database
4. **Use state parameter** to prevent CSRF attacks
5. **Implement token refresh** before expiration (tokens expire in 2 hours!)
6. **Validate redirect URIs** on your callback endpoint
7. **Use HTTPS** in production (required for OAuth 2.0)

## Media Upload Limits

| Media Type | Max Size | Max Duration | Formats |
|------------|----------|--------------|---------|
| Image | 5 MB | N/A | JPEG, PNG, GIF, WEBP |
| Animated GIF | 15 MB | N/A | GIF |
| Video | 512 MB | 2 min 20 sec | MP4 (H.264) |

> **Note**: Videos require chunked upload via the v1.1 Media API.

## Tweet Limits

| Limit | Value |
|-------|-------|
| Tweet length | 280 characters |
| Media per tweet | 4 images OR 1 GIF OR 1 video |
| URLs | Shortened to 23 characters each |
| Thread length | No limit (but rate limits apply) |

## Next Steps

Once your X Developer app is configured:

1. Connect your X account in LinkX settings
2. Start creating and scheduling tweets
3. Use cross-posting to publish to X and LinkedIn simultaneously

## Useful Links

- [X Developer Portal](https://developer.x.com/)
- [X API v2 Documentation](https://developer.x.com/en/docs/twitter-api)
- [OAuth 2.0 Authorization Code Flow with PKCE](https://developer.x.com/en/docs/authentication/oauth-2-0/authorization-code)
- [Manage Tweets API Reference](https://developer.x.com/en/docs/twitter-api/tweets/manage-tweets/api-reference)
- [Media Upload API](https://developer.x.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-upload)
- [Rate Limits](https://developer.x.com/en/docs/twitter-api/rate-limits)
- [API Access Levels](https://developer.x.com/en/docs/twitter-api/getting-started/about-twitter-api)
