import { z } from "zod";

export const ThreadsReplyControlSchema = z
  .enum([
    "everyone",
    "accounts_you_follow",
    "mentioned_only",
    "parent_post_author_only",
    "followers_only",
  ])
  .describe("Who can reply to this post");
