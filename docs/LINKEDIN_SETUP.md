# LinkedIn Developer App Setup Guide

This guide walks you through creating and configuring a LinkedIn Developer application to enable LinkedIn posting in LinkX.

## Prerequisites

- A LinkedIn account (personal profile)
- For organization posting: Admin access to a LinkedIn Company Page

## Step 1: Create a LinkedIn Developer App

1. Go to the [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
2. Click **Create app**
3. Fill in the required information:

| Field | Description | Example |
|-------|-------------|---------|
| **App name** | Your application name | `LinkX` |
| **LinkedIn Page** | Associate with a company page (required) | Select or create one |
| **Privacy policy URL** | Your privacy policy | `https://yourapp.com/privacy` |
| **App logo** | 100x100px square image | Upload your logo |

4. Check the legal agreement box and click **Create app**

## Step 2: Configure OAuth 2.0 Settings

After creating your app:

1. Go to the **Auth** tab
2. Note down your credentials:
   - **Client ID** (also called API Key)
   - **Client Secret** (keep this secure!)

3. Add **Redirect URLs** (OAuth callback URLs):
   ```
   # Development
   http://localhost:8000/api/v1/auth/linkedin/callback
   
   # Production
   https://yourdomain.com/api/v1/auth/linkedin/callback
   ```

> **Important**: URLs must be HTTPS in production. Only localhost can use HTTP.

## Step 3: Request API Products

Navigate to the **Products** tab and request access to:

### For Personal Posting (Required)
- **Share on LinkedIn** - Grants `w_member_social` permission
  - Allows posting on behalf of authenticated members
  - Usually approved instantly

### For Organization Posting (Optional, for later)
- **Marketing API** - Grants `w_organization_social` permission
  - Allows posting on behalf of company pages
  - Requires additional verification
  - May take several days for approval

### For User Profile Access
- **Sign In with LinkedIn using OpenID Connect** - Grants `openid`, `profile`, `email`
  - Required to get the user's Person URN for posting

## Step 4: Verify Permissions

After products are approved, check the **Auth** tab. You should see:

```
OAuth 2.0 scopes:
- openid
- profile  
- email
- w_member_social        # For personal posts
- w_organization_social  # For org posts (if approved)
```

## Step 5: Configure LinkX Environment Variables

Add the following to your `.env` file:

```bash
# LinkedIn OAuth Configuration
LINKEDIN_CLIENT_ID=your_client_id_here
LINKEDIN_CLIENT_SECRET=your_client_secret_here
LINKEDIN_REDIRECT_URI=http://localhost:8000/api/v1/auth/linkedin/callback

# Optional: For organization posting
LINKEDIN_ORG_ID=your_organization_id  # Found in Company Page URL
```

## Finding Your Organization ID

If you want to post to a Company Page:

1. Go to your Company Page on LinkedIn
2. Look at the URL: `https://www.linkedin.com/company/12345678/`
3. The number (`12345678`) is your Organization ID

## OAuth Scopes Reference

| Scope | Permission | Use Case |
|-------|------------|----------|
| `openid` | OpenID Connect | User authentication |
| `profile` | Basic profile | Get user's name, photo |
| `email` | Email address | Get user's email |
| `w_member_social` | Write member social | Post on behalf of user |
| `r_member_social` | Read member social | Read user's posts (restricted) |
| `w_organization_social` | Write org social | Post on behalf of company |
| `r_organization_social` | Read org social | Read company posts |
| `rw_organization_admin` | Admin org | Manage company page |

## Rate Limits

| Limit Type | Consumer API | Marketing API |
|------------|--------------|---------------|
| Per member/day | 150 requests | 100 requests |
| Per app/day | 100,000 requests | Varies |

## Token Lifespans

| Token Type | Lifespan |
|------------|----------|
| Access Token | 60 days |
| Refresh Token | 365 days (if enabled) |
| Authorization Code | 30 minutes |

## Troubleshooting

### "Invalid redirect_uri"
- Ensure the redirect URI exactly matches what's configured in the Developer Portal
- Check for trailing slashes
- Verify HTTPS in production

### "Invalid scope"
- Verify the requested products are approved
- Check the Auth tab for available scopes

### "Access denied"
- User declined the authorization
- Re-initiate the OAuth flow

### "Token expired"
- Access tokens expire after 60 days
- Implement token refresh or re-authentication flow

## Security Best Practices

1. **Never expose Client Secret** in frontend code or URLs
2. **Store tokens encrypted** in your database
3. **Use state parameter** to prevent CSRF attacks
4. **Validate redirect URIs** on your callback endpoint
5. **Implement token refresh** before expiration

## Next Steps

Once your LinkedIn app is configured:

1. Connect your LinkedIn account in LinkX settings
2. Start creating and scheduling posts
3. (Optional) Connect your Company Page for organization posts

## Useful Links

- [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
- [OAuth 2.0 Documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [Posts API Reference](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api)
- [Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api)
