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

export type EarthStyle = (typeof EARTH_STYLES)[number]['id'];
export interface EarthAppearance {
  style: EarthStyle;
  borders: boolean;
  names: boolean;
}
export const EARTH_PREFERENCE_KEY = 'orbit-earth-appearance';
export function initialEarthAppearance(): EarthAppearance {
  const defaults: EarthAppearance = {
    style: 'imagery',
    borders: false,
    names: false,
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(EARTH_PREFERENCE_KEY) || 'null',
    );
    return {
      style: EARTH_STYLES.some((style) => style.id === saved?.style)
        ? saved.style
        : defaults.style,
      borders:
        typeof saved?.borders === 'boolean' ? saved.borders : defaults.borders,
      names: typeof saved?.names === 'boolean' ? saved.names : defaults.names,
    };
  } catch {
    return defaults;
  }
}
