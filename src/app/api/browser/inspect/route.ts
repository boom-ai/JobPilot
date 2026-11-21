import { HttpError, route } from "@/lib/api";
import { inspectUrl } from "@/lib/web";

export const GET = route(async (_c, req) => {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) throw new HttpError(400, "url required");
  try {
    return await inspectUrl(url);
  } catch (e) {
    throw new HttpError(422, `Could not load page: ${(e as Error).message}`);
  }
});
