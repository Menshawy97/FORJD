/** Returns why `url` cannot be a production build's API address, or null when it can. See api-base-url.js. */
export function checkApiBaseUrl(profile: string | undefined, url: string | undefined): string | null;
