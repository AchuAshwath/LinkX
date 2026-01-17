# Social Media Integration - Feature Specification

**Version**: 1.0 (Draft)  
**Status**: Approved  
**Author**: LinkX Team  
**Date**: January 2026

---

## Decisions Made

| Topic | Decision |
|-------|----------|
| **Scheduler** | Celery + Redis |
| **Drafts** | Yes, support saving drafts |
| **Media Storage** | Keep indefinitely (user-managed media library) |
| **Multi-Account** | Yes, scalable multi-profile architecture |
| **MVP Scope** | Text + Images only (Phase 1) |
| **Architecture** | Generic social platform from day 1 (LinkedIn + Twitter) |

---

## 1. Overview

### 1.1 Summary
Enable LinkX users to connect their social media accounts (LinkedIn, Twitter/X) and schedule posts (text, images, videos, documents) to their personal profiles and organization pages.

### 1.2 Goals
- Build a **generic social platform architecture** supporting multiple networks
- Allow users to authenticate with LinkedIn and Twitter via OAuth 2.0
- Support posting to personal profiles (Phase 1)
- Support posting to organization/company pages (Phase 2+)
- Enable scheduling posts for future publication
- Support cross-posting to multiple platforms simultaneously
- Maintain a reusable media library

### 1.3 Non-Goals (Out of Scope for v1)
- LinkedIn analytics/insights
- Reading/importing existing LinkedIn posts
- LinkedIn comments and reactions
- LinkedIn messaging/InMail
- Carousel posts (requires Marketing API approval)
- Poll posts

---

## 2. User Stories

### Personal Posting
- As a user, I want to connect my LinkedIn account so I can post from LinkX
- As a user, I want to write a text post and publish it immediately to LinkedIn
- As a user, I want to attach images to my LinkedIn post
- As a user, I want to attach videos to my LinkedIn post
- As a user, I want to attach documents (PDF, PPT, DOC) to my LinkedIn post
- As a user, I want to schedule a post for a future date/time
- As a user, I want to see the status of my scheduled posts
- As a user, I want to cancel or edit a scheduled post before it's published
- As a user, I want to disconnect my LinkedIn account

### Organization Posting (Phase 2)
- As a user, I want to connect a LinkedIn Company Page I admin
- As a user, I want to choose whether to post as myself or as my company
- As a user, I want to manage multiple company pages

---

## 3. Technical Architecture

### 3.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
├─────────────────────────────────────────────────────────────────┤
│  - LinkedIn Connect Button                                       │
│  - Post Composer (text, media upload)                           │
│  - Schedule Picker                                               │
│  - Connected Accounts Management                                 │
│  - Scheduled Posts Queue View                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI)                            │
├─────────────────────────────────────────────────────────────────┤
│  API Routes:                                                     │
│  - /api/v1/auth/linkedin/authorize      (initiate OAuth)        │
│  - /api/v1/auth/linkedin/callback       (OAuth callback)        │
│  - /api/v1/linkedin/accounts            (manage connections)     │
│  - /api/v1/linkedin/posts               (create/schedule posts) │
│  - /api/v1/linkedin/media/upload        (upload media)          │
│                                                                  │
│  Services:                                                       │
│  - LinkedInOAuthService                                          │
│  - LinkedInPostService                                           │
│  - LinkedInMediaService                                          │
│  - SchedulerService                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐  ┌───────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │  Redis/Queue  │  │  LinkedIn API   │
├─────────────────┤  ├───────────────┤  ├─────────────────┤
│ - Users         │  │ - Job Queue   │  │ - OAuth 2.0     │
│ - LinkedIn      │  │ - Scheduled   │  │ - Posts API     │
│   Accounts      │  │   Posts       │  │ - Images API    │
│ - Scheduled     │  │ - Retry Logic │  │ - Videos API    │
│   Posts         │  │               │  │ - Documents API │
│ - Post History  │  │               │  │                 │
└─────────────────┘  └───────────────┘  └─────────────────┘
```

### 3.2 Database Schema

```sql
-- LinkedIn connected accounts
CREATE TABLE linkedin_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- LinkedIn identifiers
    linkedin_person_urn VARCHAR(255) NOT NULL,  -- urn:li:person:{id}
    linkedin_user_id VARCHAR(255) NOT NULL,
    
    -- Profile info (cached)
    display_name VARCHAR(255),
    email VARCHAR(255),
    profile_picture_url TEXT,
    
    -- OAuth tokens (encrypted)
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Account type
    account_type VARCHAR(50) DEFAULT 'personal',  -- 'personal' or 'organization'
    organization_urn VARCHAR(255),  -- urn:li:organization:{id} for org accounts
    organization_name VARCHAR(255),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, linkedin_person_urn),
    UNIQUE(user_id, organization_urn) WHERE organization_urn IS NOT NULL
);

-- Scheduled/published posts
CREATE TABLE linkedin_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linkedin_account_id UUID NOT NULL REFERENCES linkedin_accounts(id) ON DELETE CASCADE,
    
    -- Post content
    content_text TEXT,
    visibility VARCHAR(50) DEFAULT 'PUBLIC',  -- 'PUBLIC', 'CONNECTIONS'
    
    -- Media attachments (JSON array of media items)
    media JSONB DEFAULT '[]',
    -- Example: [{"type": "image", "url": "...", "linkedin_urn": "urn:li:image:..."}]
    
    -- Scheduling
    status VARCHAR(50) DEFAULT 'draft',  
    -- 'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
    scheduled_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    
    -- LinkedIn response
    linkedin_post_urn VARCHAR(255),  -- urn:li:share:{id} or urn:li:ugcPost:{id}
    linkedin_post_url TEXT,
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP WITH TIME ZONE,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Media uploads (for tracking upload status)
CREATE TABLE linkedin_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linkedin_account_id UUID NOT NULL REFERENCES linkedin_accounts(id) ON DELETE CASCADE,
    
    -- Media info
    media_type VARCHAR(50) NOT NULL,  -- 'image', 'video', 'document'
    original_filename VARCHAR(255),
    file_size_bytes BIGINT,
    mime_type VARCHAR(100),
    
    -- Local storage (temporary)
    local_path TEXT,
    
    -- LinkedIn upload status
    upload_status VARCHAR(50) DEFAULT 'pending',  
    -- 'pending', 'uploading', 'ready', 'failed'
    linkedin_asset_urn VARCHAR(255),  -- urn:li:image:{id}, urn:li:video:{id}, etc.
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE  -- For cleanup
);

-- Indexes
CREATE INDEX idx_linkedin_accounts_user ON linkedin_accounts(user_id);
CREATE INDEX idx_linkedin_posts_user ON linkedin_posts(user_id);
CREATE INDEX idx_linkedin_posts_status ON linkedin_posts(status);
CREATE INDEX idx_linkedin_posts_scheduled ON linkedin_posts(scheduled_at) 
    WHERE status = 'scheduled';
CREATE INDEX idx_linkedin_media_user ON linkedin_media(user_id);
```

### 3.3 API Endpoints

#### Authentication
```
GET  /api/v1/auth/linkedin/authorize
     - Initiates OAuth flow, returns redirect URL
     - Query params: ?account_type=personal|organization

GET  /api/v1/auth/linkedin/callback
     - OAuth callback handler
     - Exchanges code for tokens, stores account
     - Redirects to frontend with success/error
```

#### Account Management
```
GET    /api/v1/linkedin/accounts
       - List user's connected LinkedIn accounts
       
GET    /api/v1/linkedin/accounts/{id}
       - Get specific account details
       
DELETE /api/v1/linkedin/accounts/{id}
       - Disconnect/remove a LinkedIn account
       
POST   /api/v1/linkedin/accounts/{id}/refresh
       - Manually refresh access token
```

#### Posts
```
POST   /api/v1/linkedin/posts
       - Create a new post (draft, immediate, or scheduled)
       - Body: { account_id, content, media_ids[], visibility, scheduled_at? }

GET    /api/v1/linkedin/posts
       - List user's posts (with filters: status, date range)
       
GET    /api/v1/linkedin/posts/{id}
       - Get specific post details
       
PATCH  /api/v1/linkedin/posts/{id}
       - Update a draft/scheduled post
       
DELETE /api/v1/linkedin/posts/{id}
       - Delete/cancel a post (only if not published)
       
POST   /api/v1/linkedin/posts/{id}/publish
       - Publish a draft post immediately
```

#### Media Upload
```
POST   /api/v1/linkedin/media/upload
       - Upload media file (image, video, document)
       - Multipart form data
       - Returns: { media_id, status, linkedin_urn? }

GET    /api/v1/linkedin/media/{id}/status
       - Check upload/processing status (for videos)
       
DELETE /api/v1/linkedin/media/{id}
       - Delete uploaded media (if not used in published post)
```

### 3.4 LinkedIn API Integration

#### API Versions & Headers
```python
# Required headers for all LinkedIn API calls
headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": "202601"  # Use latest version
}
```

#### Content Type Mapping
| LinkX Media Type | LinkedIn API | URN Format |
|------------------|--------------|------------|
| Image | Images API | `urn:li:image:{id}` |
| Video | Videos API | `urn:li:video:{id}` |
| Document | Documents API | `urn:li:document:{id}` |
| Article/URL | Inline in post | N/A |

#### Media Upload Flow
```
1. Frontend uploads file to LinkX backend
2. Backend stores file temporarily
3. Backend registers upload with LinkedIn (get upload URL)
4. Backend uploads binary to LinkedIn's upload URL
5. Backend polls for processing status (videos only)
6. Backend returns LinkedIn asset URN to frontend
7. Frontend includes URN in post creation request
```

---

## 4. Scheduling System

### 4.1 Architecture Options

**Option A: Database Polling (Simple)**
- Cron job runs every minute
- Queries for posts where `scheduled_at <= NOW() AND status = 'scheduled'`
- Publishes matching posts
- Pros: Simple, no additional infrastructure
- Cons: Up to 1-minute delay, DB load

**Option B: Task Queue (Recommended)**
- Use Celery + Redis (or similar)
- Schedule task at exact `scheduled_at` time
- Pros: Precise timing, scalable, retry support
- Cons: Additional infrastructure

**Option C: APScheduler (Middle Ground)**
- In-process scheduler
- Good for single-instance deployments
- Pros: No Redis needed, precise timing
- Cons: Lost jobs on restart, not horizontally scalable

### 4.2 Recommended: Celery + Redis

```python
# Task definition
@celery.task(bind=True, max_retries=3)
def publish_linkedin_post(self, post_id: str):
    try:
        post = get_post(post_id)
        linkedin_service.publish(post)
        update_post_status(post_id, "published")
    except LinkedInAPIError as e:
        update_post_status(post_id, "failed", error=str(e))
        if e.is_retryable:
            self.retry(countdown=60 * (2 ** self.request.retries))
```

### 4.3 Failure Handling
- Retry up to 3 times with exponential backoff
- Mark as `failed` after all retries exhausted
- Notify user via email/in-app notification
- Allow manual retry from UI

---

## 5. Security Considerations

### 5.1 Token Storage
- Encrypt access tokens at rest using Fernet (symmetric encryption)
- Store encryption key in environment variable
- Never log tokens

### 5.2 Token Refresh
- Check token expiry before each API call
- Refresh proactively (e.g., when < 7 days remaining)
- Handle refresh failures gracefully

### 5.3 OAuth Security
- Use `state` parameter to prevent CSRF
- Validate redirect URIs strictly
- Use PKCE if supported (LinkedIn doesn't currently)

### 5.4 Rate Limiting
- Track API calls per user/account
- Implement backoff when approaching limits
- Queue posts if rate limited

---

## 6. Frontend Components

### 6.1 New Components Needed

```
src/components/LinkedIn/
├── ConnectLinkedInButton.tsx    # OAuth initiation
├── LinkedInAccountCard.tsx      # Display connected account
├── LinkedInAccountList.tsx      # List of connected accounts
├── LinkedInPostComposer.tsx     # Create/edit posts
├── LinkedInMediaUpload.tsx      # Upload images/videos/docs
├── LinkedInSchedulePicker.tsx   # Date/time picker for scheduling
├── LinkedInPostQueue.tsx        # View scheduled posts
├── LinkedInPostCard.tsx         # Individual post in queue
└── LinkedInSettings.tsx         # Account management page
```

### 6.2 Routes
```
/settings/linkedin           # Manage connected accounts
/compose/linkedin            # Create new LinkedIn post
/queue/linkedin              # View scheduled posts
```

---

## 7. Implementation Phases

### Phase 1: Core Personal Posting (MVP)
- [ ] LinkedIn OAuth flow (connect account)
- [ ] Store account credentials securely (encrypted)
- [ ] Draft posts (save without scheduling)
- [ ] Text-only posts (immediate publish)
- [ ] Image posts
- [ ] Scheduling with Celery + Redis
- [ ] Post queue view (drafts, scheduled, published, failed)
- [ ] Disconnect account
- [ ] Media library (persistent storage)

**Estimated effort**: 2-3 weeks

### Phase 2: Full Media Support
- [ ] Video upload and posting
- [ ] Document upload and posting
- [ ] Article/URL posts with previews
- [ ] Improved media upload UI (progress, preview)
- [ ] Media library management UI

**Estimated effort**: 1-2 weeks

### Phase 3: Multi-Account & Scalability
- [ ] Multiple personal LinkedIn accounts per user
- [ ] Account switching in post composer
- [ ] Per-account rate limit tracking
- [ ] Bulk actions (schedule to multiple accounts)

**Estimated effort**: 1-2 weeks

### Phase 4: Organization Posting
- [ ] Marketing API integration
- [ ] Connect company pages
- [ ] Post as organization
- [ ] Organization selector in composer
- [ ] Role-based access for team posting

**Estimated effort**: 1-2 weeks

---

## 8. Configuration & Environment Variables

```bash
# Required
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:8000/api/v1/auth/linkedin/callback

# Token encryption
LINKEDIN_TOKEN_ENCRYPTION_KEY=your_fernet_key  # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Optional (for Phase 3+)
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# Rate limiting
LINKEDIN_RATE_LIMIT_PER_USER=100  # per day
```

---

## 9. Testing Strategy

### Unit Tests
- OAuth token handling
- Post creation logic
- Media upload logic
- Scheduling logic

### Integration Tests
- Full OAuth flow (mock LinkedIn)
- Post creation with media
- Scheduled post execution

### E2E Tests (Playwright)
- Connect LinkedIn account flow
- Create and publish post
- Schedule and verify post

---

## 10. Open Questions

1. **Token refresh strategy**: Proactive refresh vs. on-demand?
2. **Post templates**: Save frequently used post formats?
3. **Character limits**: LinkedIn has a 3000 char limit - enforce in UI?
4. **Hashtag suggestions**: Auto-suggest hashtags based on content?
5. **Best time to post**: Suggest optimal posting times?
6. **Post preview**: Show LinkedIn-style preview before publishing?
7. **Analytics**: Track post performance? (requires additional API access)

---

## 11. Multi-Account Architecture (Discussion)

### The Challenge
You want LinkX to be scalable and support:
- Multiple LinkedIn personal accounts per user
- Organization/company page accounts
- Potentially other social platforms in the future (Twitter/X, Instagram, etc.)

### Proposed Architecture: Social Accounts Abstraction

Instead of LinkedIn-specific tables, we create a generic "social accounts" system:

```sql
-- Generic social account (LinkedIn, Twitter, etc.)
CREATE TABLE social_accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Platform identification
    platform VARCHAR(50) NOT NULL,  -- 'linkedin', 'twitter', 'instagram'
    account_type VARCHAR(50) NOT NULL,  -- 'personal', 'organization', 'page'
    
    -- Platform-specific identifiers
    platform_user_id VARCHAR(255) NOT NULL,
    platform_account_urn VARCHAR(255),  -- LinkedIn URN, Twitter handle, etc.
    
    -- Display info
    display_name VARCHAR(255),
    username VARCHAR(255),
    profile_picture_url TEXT,
    
    -- OAuth tokens (encrypted, platform-agnostic)
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    token_scopes TEXT[],  -- Array of granted scopes
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata (platform-specific extras)
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, platform, platform_user_id)
);

-- Generic scheduled post
CREATE TABLE social_posts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Can target multiple accounts
    target_accounts UUID[] NOT NULL,  -- Array of social_account IDs
    
    -- Content (platform-agnostic base)
    content_text TEXT,
    
    -- Media (references to media library)
    media_ids UUID[],
    
    -- Scheduling
    status VARCHAR(50) DEFAULT 'draft',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    
    -- Platform-specific content/settings
    platform_settings JSONB DEFAULT '{}',
    -- Example: { "linkedin": { "visibility": "PUBLIC" }, "twitter": { "reply_settings": "everyone" } }
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Per-account post results (one post can go to multiple accounts)
CREATE TABLE social_post_results (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES social_posts(id),
    social_account_id UUID NOT NULL REFERENCES social_accounts(id),
    
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'published', 'failed'
    published_at TIMESTAMP WITH TIME ZONE,
    
    -- Platform response
    platform_post_id VARCHAR(255),
    platform_post_url TEXT,
    
    -- Errors
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    UNIQUE(post_id, social_account_id)
);

-- Reusable media library
CREATE TABLE media_library (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- File info
    filename VARCHAR(255),
    mime_type VARCHAR(100),
    file_size_bytes BIGINT,
    
    -- Storage
    storage_path TEXT NOT NULL,  -- Local path or S3 URL
    thumbnail_path TEXT,
    
    -- Metadata
    width INTEGER,
    height INTEGER,
    duration_seconds INTEGER,  -- For videos
    
    -- Platform uploads (cached URNs to avoid re-uploading)
    platform_uploads JSONB DEFAULT '{}',
    -- Example: { "linkedin": { "urn": "urn:li:image:123", "uploaded_at": "..." } }
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Benefits of This Approach

1. **Add new platforms easily** - Just implement a new platform adapter
2. **Cross-post support** - One post can target multiple platforms
3. **Unified media library** - Upload once, use everywhere
4. **Consistent UX** - Same UI patterns for all platforms
5. **Efficient media handling** - Cache platform-specific uploads

### Platform Adapter Pattern

```python
# Abstract base class
class SocialPlatformAdapter(ABC):
    @abstractmethod
    def authenticate(self, auth_code: str) -> TokenResponse: ...
    
    @abstractmethod
    def refresh_token(self, refresh_token: str) -> TokenResponse: ...
    
    @abstractmethod
    def get_profile(self, access_token: str) -> ProfileInfo: ...
    
    @abstractmethod
    def upload_media(self, access_token: str, file: File) -> MediaUploadResult: ...
    
    @abstractmethod
    def create_post(self, access_token: str, post: PostContent) -> PostResult: ...
    
    @abstractmethod
    def delete_post(self, access_token: str, post_id: str) -> bool: ...

# LinkedIn implementation
class LinkedInAdapter(SocialPlatformAdapter):
    def authenticate(self, auth_code: str) -> TokenResponse:
        # LinkedIn OAuth implementation
        ...
    
    def create_post(self, access_token: str, post: PostContent) -> PostResult:
        # LinkedIn Posts API implementation
        ...

# Future: Twitter implementation
class TwitterAdapter(SocialPlatformAdapter):
    ...
```

### Questions to Consider

~~1. **Start generic or LinkedIn-first?**~~
   - ~~Option A: Build LinkedIn-specific now, refactor to generic later~~
   - ~~Option B: Build generic architecture now, LinkedIn as first adapter~~
   - **Decision: Generic architecture from day 1, with LinkedIn and Twitter as initial platforms**
   
2. **Cross-posting UX**
   - Should users see one composer for all platforms?
   - Or separate flows per platform?
   
3. **Platform-specific features**
   - Some platforms have unique features (LinkedIn polls, Twitter threads)
   - How to handle in a generic system?

---

## 12. Revised Implementation Phases (Generic Architecture)

Given the decision to build generic social platform support from day 1:

### Phase 1a: Core Infrastructure (Week 1-2)
- [ ] Generic `social_accounts` table and models
- [ ] Generic `social_posts` table with status tracking
- [ ] Media library with persistent storage
- [ ] Platform adapter interface (abstract base class)
- [ ] Celery + Redis setup for scheduling
- [ ] Token encryption service

### Phase 1b: LinkedIn Adapter (Week 2-3)
- [ ] LinkedIn OAuth flow implementation
- [ ] LinkedIn profile fetching
- [ ] LinkedIn image upload (Images API)
- [ ] LinkedIn text + image posting (Posts API)
- [ ] LinkedIn-specific settings (visibility)

### Phase 1c: Frontend MVP (Week 3-4)
- [ ] Connect social account flow (generic, LinkedIn first)
- [ ] Post composer with platform selector
- [ ] Draft saving
- [ ] Schedule picker
- [ ] Post queue view (drafts, scheduled, published, failed)
- [ ] Account management page

### Phase 2: Twitter Integration (Week 5-6)
- [ ] Twitter OAuth 2.0 flow
- [ ] Twitter profile fetching
- [ ] Twitter image upload
- [ ] Twitter posting (tweets)
- [ ] Twitter-specific settings (reply restrictions)
- [ ] Cross-posting UI (post to LinkedIn + Twitter)

### Phase 3: Full Media Support (Week 7-8)
- [ ] Video upload (LinkedIn Videos API, Twitter)
- [ ] Document upload (LinkedIn Documents API)
- [ ] Article/URL posts with previews
- [ ] Media library management UI
- [ ] Upload progress and previews

### Phase 4: Multi-Account & Advanced Features (Week 9-10)
- [ ] Multiple accounts per platform per user
- [ ] Account switching in composer
- [ ] Bulk scheduling to multiple accounts
- [ ] Post templates
- [ ] Analytics (if API access available)

### Phase 5: Organization/Business Accounts (Week 11+)
- [ ] LinkedIn Company Pages (Marketing API)
- [ ] Twitter Business accounts
- [ ] Team collaboration features
- [ ] Role-based access control

---

## 13. References

- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [LinkedIn OAuth 2.0](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [LinkedIn Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
- [LinkedIn Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api)
- [LinkedIn Documents API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api)
- [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
