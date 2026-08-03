import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VOYARA AI Travel Operating System',
    short_name: 'VOYARA',
    description: 'Human-controlled travel operations for Azerbaijan.',
    start_url: '/az',
    display: 'standalone',
    background_color: '#08111f',
    theme_color: '#08111f',
    lang: 'az',
    icons: [
      {
        src: '/brand/voyara-mark.png',
        sizes: 'any',
        type: 'image/png',
        purpose: 'any'
      }
    ]
  };
}
