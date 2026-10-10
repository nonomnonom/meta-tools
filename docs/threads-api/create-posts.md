# Threads API: Creating Posts

Publish image, video, text, or carousel posts on Threads. Supports quote posts and reposts.

## Permissions Required

- `threads_basic`
- `threads_content_publish`

## Supported Media Types

| Type | `media_type` value |
|------|-------------------|
| Text | `TEXT` |
| Image | `IMAGE` |
| Video | `VIDEO` |
| Carousel | `CAROUSEL` |

## Publishing Flow

Same two-step container pattern as Instagram:

### Step 1: Create Container

```
POST /{threads-user-id}/threads
```

**Text post:**

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=TEXT" \
  -d "text=Hello Threads!" \
  -d "access_token={access-token}"
```

**Image post:**

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=IMAGE" \
  -d "image_url=https://example.com/photo.jpg" \
  -d "text=Check this out" \
  -d "access_token={access-token}"
```

**Video post:**

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=VIDEO" \
  -d "video_url=https://example.com/video.mp4" \
  -d "text=Watch this" \
  -d "access_token={access-token}"
```

**Carousel post:**

```bash
# Create item containers first
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=IMAGE" \
  -d "image_url=https://example.com/photo1.jpg" \
  -d "is_carousel_item=true" \
  -d "access_token={access-token}"

# Then create carousel container
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=CAROUSEL" \
  -d "children={item-id-1},{item-id-2}" \
  -d "text=My carousel" \
  -d "access_token={access-token}"
```

### Step 2: Publish

```
POST /{threads-user-id}/threads_publish
```

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads_publish" \
  -d "creation_id={container-id}" \
  -d "access_token={access-token}"
```

## Reposts

Repost an existing Threads post. The post ID is the path segment:

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-media-id}/repost" \
  -d "access_token={access-token}"
```

## GIF attachments

GIF posts are text posts with a `gif_attachment`, not image containers. For example:

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d 'media_type=TEXT' \
  -d 'gif_attachment={"gif_id":"{tenor-gif-id}","provider":"TENOR"}' \
  -d "access_token={access-token}"
```

Publish the returned container ID with `POST /{threads-user-id}/threads_publish`.

## Search

Keyword search uses `GET /keyword_search` with `q`, `search_type` (`TOP` or `RECENT`), and the fields to return. It requires the `threads_keyword_search` permission.

## Reply controls

When creating a post, the API supports `everyone`, `accounts_you_follow`, `mentioned_only`, `parent_post_author_only`, and `followers_only`. Account permissions and availability are controlled by Meta.

## Quote Posts

Create a new post that quotes an existing one:

```bash
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=TEXT" \
  -d "text=My thoughts on this" \
  -d "quote_post_id={threads-media-id}" \
  -d "access_token={access-token}"
```

## Fediverse Sharing

Since August 2024, users who have opted into fediverse sharing can have their posts distributed to the fediverse (ActivityPub). This applies automatically to API-published posts for enabled accounts.

## Additional Features

### Ghost Posts

Posts visible only via direct link, not shown in feeds or search.

### Polls

Attach a poll to a text post with predefined answer options.

### Spoilers

Mark posts with a spoiler warning that requires a tap to reveal content.

### Text Attachments

Attach link previews to text posts by including a URL in the text.

### Location Tagging

Tag a geographic location on a post.

### Geo-Gated Content

Restrict post visibility to specific geographic regions.

### Accessibility

Provide alt text for images to improve accessibility for screen reader users.
