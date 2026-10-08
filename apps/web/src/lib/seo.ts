/**
 * What search engines are told about FORJD (structured data, schema.org). It describes only what is true today: no ratings, reviews,
 * prices or download links, because the app is not in the stores yet. `alternateName` lists the other ways people write the name
 * (the "FORJD app" and "Get FORJD" searches). `site` is the site's own address with a trailing slash, from Astro.site.
 */
export function siteJsonLd(site: string): Record<string, unknown> {
  const org = `${site}#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: 'FORJD',
        url: site,
        logo: `${site}apple-touch-icon.png`,
        contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'support@getforjd.com' },
      },
      {
        '@type': 'WebSite',
        '@id': `${site}#website`,
        name: 'FORJD',
        alternateName: ['FORJD app', 'Get FORJD'],
        url: site,
        publisher: { '@id': org },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'FORJD',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Android, iOS',
        description:
          'The FORJD app connects your training, recovery, nutrition and body composition in one place and explains what they mean. Coming soon to iPhone and Android.',
        url: site,
      },
    ],
  };
}

/** Safe to write inside a script tag: a "<" in the data can never close it. */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\u003c');
}
