import { createHmac, timingSafeEqual } from "node:crypto";

export interface MetaSignedRequestPayload {
  algorithm: "HMAC-SHA256";
  user_id: string;
}

export function verifyMetaSignedRequest(value: unknown, appSecret: string): MetaSignedRequestPayload | undefined {
  if (typeof value !== "string" || value.length > 16_384 || !appSecret) return undefined;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return undefined;
  try {
    const providedSignature = Buffer.from(parts[0], "base64url");
    const expectedSignature = createHmac("sha256", appSecret).update(parts[1]).digest();
    if (providedSignature.length !== expectedSignature.length || !timingSafeEqual(providedSignature, expectedSignature)) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<MetaSignedRequestPayload>;
    if (payload.algorithm !== "HMAC-SHA256" || typeof payload.user_id !== "string" || !/^\d{1,32}$/.test(payload.user_id)) return undefined;
    return { algorithm: payload.algorithm, user_id: payload.user_id };
  } catch {
    return undefined;
  }
}
