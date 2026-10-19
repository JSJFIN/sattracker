export const CATALOG = [
  {
    id: 25544,
    name: 'ISS',
    description: 'International Space Station',
    category: 'Crewed',
  },
  {
    id: 20580,
    name: 'Hubble',
    description: 'Hubble Space Telescope',
    category: 'Science',
  },
  {
    id: 25994,
    name: 'Terra',
    description: 'Earth observation',
    category: 'Earth',
  },
  {
    id: 27424,
    name: 'Aqua',
    description: 'Water cycle & climate',
    category: 'Earth',
  },
  {
    id: 43013,
    name: 'NOAA 20',
    description: 'Polar weather observation',
    category: 'Weather',
  },
  {
    id: 37849,
    name: 'Suomi NPP',
    description: 'Weather & environmental science',
    category: 'Weather',
  },
  {
    id: 39634,
    name: 'Sentinel-1A',
    description: 'Radar Earth observation',
    category: 'Earth',
  },
  {
    id: 40697,
    name: 'Sentinel-2A',
    description: 'Multispectral Earth imaging',
    category: 'Earth',
  },
  {
    id: 39084,
    name: 'Landsat 8',
    description: 'Land surface observation',
    category: 'Earth',
  },
  {
    id: 41866,
    name: 'GOES 16',
    description: 'Geosynchronous weather satellite',
    category: 'Weather',
  },
] as const;

export const COLORS = [
  '#83e9ce',
  '#e6b881',
  '#9ba7ff',
  '#f08e9c',
  '#7fc7f0',
  '#d1a4ed',
  '#c6db83',
  '#f3a776',
  '#7ed4b3',
  '#f1d380',
];
export const DEFAULT_IDS = CATALOG.map((satellite) => satellite.id);
