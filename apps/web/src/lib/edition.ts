// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
/** The meta-pos build (infra/meta/pos.Dockerfile sets PUBLIC_BITPOS_EDITION=meta): Stripe instead of crypto, Meta tabs. */
export const META=(import.meta.env as Record<string,string|undefined>).PUBLIC_BITPOS_EDITION==='meta';
