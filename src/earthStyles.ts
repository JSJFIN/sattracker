export const EARTH_STYLES = [
  { id: 'imagery', name: 'Imagery', texture: '/textures/earth-day.jpg' },
  {
    id: 'natural',
    name: 'Natural Earth',
    texture: '/textures/earth-natural.jpg',
  },
  { id: 'gray', name: 'Gray Earth', texture: '/textures/earth-gray.jpg' },
  {
    id: 'countries',
    name: 'Country map',
    texture: '/textures/earth-countries.jpg',
  },
] as const;

export type { EarthAppearance } from '../shared/preferences';
export type EarthStyle = (typeof EARTH_STYLES)[number]['id'];
