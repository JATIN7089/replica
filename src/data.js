// ============================================================================
// Northhold — static game data
// A Northgard-style Viking RTS that runs entirely in the browser.
// ============================================================================

// --- Time -------------------------------------------------------------------
export const MONTH_SECONDS = 6; // 1 in-game month = 6 real seconds at 1x
export const MONTHS_PER_SEASON = 3;
export const SEASON_SECONDS = MONTH_SECONDS * MONTHS_PER_SEASON;
export const YEAR_MONTHS = MONTHS_PER_SEASON * 4;
export const TIMEOUT_YEARS = 9; // highest fame wins after this many years

// --- Resources --------------------------------------------------------------
export const RESOURCES = ['food', 'wood', 'krown', 'stone', 'iron', 'lore'];

export const RESOURCE_META = {
  food: { name: 'Food', icon: '🍖', color: '#c9773c' },
  wood: { name: 'Wood', icon: '🪵', color: '#8a6a45' },
  krown: { name: 'Krowns', icon: '🪙', color: '#d8b449' },
  stone: { name: 'Stone', icon: '🪨', color: '#9aa0a6' },
  iron: { name: 'Iron', icon: '⛓️', color: '#7f8fa6' },
  lore: { name: 'Lore', icon: '📜', color: '#8f7fd0' },
  fame: { name: 'Fame', icon: '⭐', color: '#e0c060' },
  happiness: { name: 'Happiness', icon: '😊', color: '#7fc47f' },
};

export const START_RESOURCES = {
  food: 90,
  wood: 70,
  krown: 40,
  stone: 0,
  iron: 0,
  lore: 0,
};

// --- Terrain ----------------------------------------------------------------
export const TERRAIN = {
  plains: {
    name: 'Plains', land: true, color: '#6d8b48', alt: '#67854a',
    blurb: 'Open ground. Cheap to settle, no gathering bonus.',
  },
  forest: {
    name: 'Forest', land: true, color: '#3d6a45', alt: '#38633f',
    blurb: 'Woodcutter lodges and hunters thrive here.',
  },
  fertile: {
    name: 'Fertile Land', land: true, color: '#8b9b45', alt: '#849239',
    blurb: 'The only place a Farm can be raised.',
  },
  wildlife: {
    name: 'Wildlands', land: true, color: '#4e7146', alt: '#486a41',
    blurb: 'Deer roam here — hunters bring in extra food.',
  },
  lake: {
    name: 'Lake', land: false, water: true, color: '#2c5b78', alt: '#2a5671',
    blurb: 'Impassable water. A Fisherman Hut can be built on it.',
  },
  mountain: {
    name: 'Mountain', land: true, color: '#6a6870', alt: '#65636b',
    blurb: 'Stone deposits. A Stone Mine can be carved here.',
  },
  iron: {
    name: 'Iron Deposit', land: true, color: '#5c5a64', alt: '#575560',
    blurb: 'Rich iron veins — needed for the finest wargear.',
  },
  ruins: {
    name: 'Ancient Ruins', land: true, color: '#7d6a54', alt: '#776551',
    blurb: 'Send any warrior to explore for a reward.',
  },
};

export const COLONIZE_COST = 22; // base food
export const TERRAIN_COLONIZE_EXTRA = {
  plains: 0, forest: 2, fertile: 4, wildlife: 3, ruins: 3,
  mountain: 10, iron: 12, lake: 8,
};

export const BUILDINGS_PER_TILE = 3;
export const START_BUILDINGS_PER_TILE = 2; // cap before the 2nd House is raised

// --- Seasons ----------------------------------------------------------------
export const SEASONS = [
  {
    key: 'spring', name: 'Spring', icon: '🌱', color: '#7fbf6a',
    foodMul: 0.95, happiness: 1,
  },
  {
    key: 'summer', name: 'Summer', icon: '☀️', color: '#e0c060',
    foodMul: 1.15, happiness: 5,
  },
  {
    key: 'autumn', name: 'Autumn', icon: '🍂', color: '#d08a45',
    foodMul: 1.0, happiness: 2,
  },
  {
    key: 'winter', name: 'Winter', icon: '❄️', color: '#9fc7e8',
    foodMul: 0.35, happiness: -9, foodUse: 1.45, woodUse: 1.2,
  },
];

// --- Clans ------------------------------------------------------------------
export const CLANS = {
  wolf: {
    id: 'wolf', name: 'Clan of the Wolf', color: '#e09a3a', banner: '#f0b757',
    motto: 'Glory is taken, never given.',
    bonus: '+25% warband damage · −25% warband food upkeep',
    mods: { warriorDmg: 1.25, warbandFood: 0.75 },
  },
  stag: {
    id: 'stag', name: 'Clan of the Stag', color: '#3f9e8f', banner: '#63c7b7',
    motto: 'The land provides for the patient.',
    bonus: '+30% Farm & Hunter food · +2 Lore per month from the Town Hall',
    mods: { farmFood: 1.3, hunterFood: 1.3, loreFlat: 2 },
  },
  raven: {
    id: 'raven', name: 'Clan of the Raven', color: '#6b6fd6', banner: '#9094ee',
    motto: 'Every coast is a door.',
    bonus: '+50% Krowns · −30% settlement cost · Scouts are cheaper',
    mods: { krown: 1.5, colonize: 0.7, scoutCost: 0.6 },
  },
};

export const AI_COLOR = '#cf4b4b';
export const AI_BANNER = '#e8746f';
export const AI_NAMES = {
  wolf: 'Jarl Sigrun of the Wolf', stag: 'Jarl Eirik of the Stag', raven: 'Jarl Hrafn of the Raven',
};

// --- Blessings (spent Lore) -------------------------------------------------
export const BLESSING_COST = 40;
export const MAX_BLESSINGS = 5;

export const BLESSINGS = {
  hardwood:   { name: 'Hardwood',        icon: '🪓', desc: 'Woodcutters produce +25% wood.',            mods: { wood: 1.25 } },
  abundance:  { name: 'Abundance',       icon: '🌾', desc: 'All food production +20%.',                 mods: { food: 1.2 } },
  ironwill:   { name: 'Iron Will',       icon: '🛡️', desc: 'Warband gains +20% damage and +15% health.', mods: { warriorDmg: 1.2, warriorHp: 1.15 } },
  coinage:    { name: 'Coinage',         icon: '💰', desc: 'Markets produce +40% krowns.',              mods: { krown: 1.4 } },
  cartography:{ name: 'Cartography',     icon: '🗺️', desc: 'Settling new land costs 35% less food.',    mods: { colonize: 0.65 } },
  festival:   { name: 'Festival',        icon: '🎉', desc: 'Happiness +10.',                            mods: { happy: 10 } },
  fertility:  { name: 'Fertility',       icon: '👶', desc: 'Population grows 35% faster.',              mods: { growth: 1.35 } },
  sagas:      { name: 'Sagas',           icon: '📖', desc: 'Fame gains +60%.',                          mods: { fame: 1.6 } },
  masonry:    { name: 'Masonry',         icon: '🧱', desc: 'Buildings +40% health, −20% wood cost.',    mods: { buildHp: 1.4, buildCost: 0.8 } },
  swiftness:  { name: 'Swiftness',       icon: '💨', desc: 'All units move +20% faster.',               mods: { unitSpeed: 1.2 } },
  runes:      { name: 'Runecraft',       icon: 'ᚱ',  desc: 'Altars produce +50% lore.',                 mods: { lore: 1.5 } },
  hearth:     { name: 'Hearth Fire',     icon: '🔥', desc: 'Suffer 60% less food loss in winter.',      mods: { winterEase: 0.4 } },
};
export const BLESSING_IDS = Object.keys(BLESSINGS);

// --- Buildings --------------------------------------------------------------
// rate = resource units produced per worker per month (before multipliers)
export const BUILDINGS = {
  townhall: {
    id: 'townhall', name: 'Town Hall', icon: '🏛️', hp: 700, build: 0, cost: {},
    limit: 1, unique: true, terrain: '*', desc: 'Heart of the clan. Trains villagers, gives +6 population cap.',
    popCap: 6, train: true, slots: 0,
  },
  house: {
    id: 'house', name: 'House', icon: '🏠', hp: 220, build: 11, cost: { wood: 45 },
    limit: 8, terrain: ['plains', 'fertile', 'forest', 'wildlife', 'mountain', 'iron'],
    desc: '+4 population cap and +2 happiness while there is room. An army needs room to grow.',
    popCap: 4, happy: 2, slots: 0,
  },
  woodcutter: {
    id: 'woodcutter', name: "Woodcutter's Lodge", icon: '🪵', hp: 180, build: 8,
    cost: { wood: 25 }, limit: 4, terrain: ['forest', 'wildlife', 'plains'],
    desc: 'Each woodcutter fells 3.2 wood per month.',
    job: 'woodcutter', slots: 2, rate: 3.2, res: 'wood',
  },
  hunter: {
    id: 'hunter', name: "Hunter's Lodge", icon: '🏹', hp: 180, build: 9,
    cost: { wood: 35 }, limit: 3, terrain: ['forest', 'wildlife', 'plains'],
    desc: 'Hunters bring home 3.1 food per month (extra on Wildlands).',
    job: 'hunter', slots: 2, rate: 3.1, res: 'food', wildBonus: 1.35,
  },
  farm: {
    id: 'farm', name: 'Farm', icon: '🌾', hp: 180, build: 11,
    cost: { wood: 45 }, limit: 4, terrain: ['fertile', 'plains'],
    desc: 'Three farmers work the field. Farms yield far less in winter.',
    job: 'farmer', slots: 3, rate: 3.0, res: 'food', seasonal: 1.25, fertileBonus: 1.3,
  },
  fishery: {
    id: 'fishery', name: 'Fisherman Hut', icon: '🐟', hp: 160, build: 9,
    cost: { wood: 35 }, limit: 4, terrain: ['lake'],
    desc: 'Two fishers net 3.4 food per month, in every season.',
    job: 'fisher', slots: 2, rate: 3.4, res: 'food',
  },
  mine: {
    id: 'mine', name: 'Stone Mine', icon: '⛏️', hp: 200, build: 13,
    cost: { wood: 55 }, limit: 3, terrain: ['mountain'],
    desc: 'Two miners cut 1.7 stone per month. Deposits are finite.',
    job: 'miner', slots: 2, rate: 1.7, res: 'stone', deposit: 'stone', depositMax: 260,
  },
  ironmine: {
    id: 'ironmine', name: 'Iron Mine', icon: '🔩', hp: 200, build: 14,
    cost: { wood: 60, stone: 10 }, limit: 3, terrain: ['iron'],
    desc: 'Two miners raise 1.2 iron per month. Veins are finite.',
    job: 'miner', slots: 2, rate: 1.2, res: 'iron', deposit: 'iron', depositMax: 160,
  },
  forge: {
    id: 'forge', name: 'Forge', icon: '⚒️', hp: 200, build: 14,
    cost: { wood: 55, stone: 15 }, limit: 2,
    terrain: ['plains', 'fertile', 'mountain', 'iron', 'forest', 'wildlife'],
    desc: 'A smith turns 0.8 iron per month into wargear: +6% warband damage per month, up to +30%. Unlocks Axe Throwers and Shield Bearers.',
    job: 'smith', slots: 1, rate: 0, res: null, smith: true, consume: { iron: 0.8 },
  },
  market: {
    id: 'market', name: 'Market', icon: '🏪', hp: 180, build: 12,
    cost: { wood: 50, stone: 15 }, limit: 2, terrain: ['plains', 'fertile', 'forest'],
    desc: 'Two merchants trade for 2.3 krowns per month. Also unlocks trading resources for krowns.',
    job: 'merchant', slots: 2, rate: 2.3, res: 'krown',
  },
  brewery: {
    id: 'brewery', name: 'Brewery', icon: '🍺', hp: 180, build: 13,
    cost: { wood: 60, stone: 10 }, limit: 2, terrain: ['plains', 'fertile', 'forest', 'wildlife'],
    desc: 'A brewer keeps spirits up: +7 Happiness.',
    job: 'brewer', slots: 1, rate: 0, res: null, happy: 7,
  },
  altar: {
    id: 'altar', name: 'Altar of Odin', icon: '🗿', hp: 200, build: 15,
    cost: { wood: 55, stone: 20 }, limit: 3, terrain: ['plains', 'forest', 'mountain', 'wildlife', 'ruins', 'fertile'],
    desc: 'A loremaster gathers 1.8 Lore per month. Spend Lore on Blessings.',
    job: 'loremaster', slots: 1, rate: 1.8, res: 'lore',
  },
  barracks: {
    id: 'barracks', name: 'Barracks', icon: '🛡️', hp: 280, build: 15,
    cost: { wood: 65, stone: 15 }, limit: 3,
    terrain: ['plains', 'fertile', 'forest', 'wildlife', 'mountain', 'iron'],
    desc: 'Trains the warband (faster with a trainer assigned) and adds +2 warband capacity.',
    job: 'trainer', slots: 1, rate: 0, res: null, warbandCap: 2, train: true,
  },
  tower: {
    id: 'tower', name: 'Watchtower', icon: '🗼', hp: 340, build: 14,
    cost: { wood: 35, stone: 30 }, limit: 4,
    terrain: ['plains', 'fertile', 'forest', 'wildlife', 'mountain', 'iron'],
    desc: 'Archers on the wall damage enemies on nearby tiles. Requires a worker.',
    job: 'archer', slots: 1, rate: 0, res: null, tower: { dmg: 7, range: 2 },
  },
  tradingpost: {
    id: 'tradingpost', name: 'Trading Post', icon: '⚖️', hp: 200, build: 14,
    cost: { wood: 60, krown: 30 }, limit: 2, terrain: ['plains', 'fertile'],
    desc: 'A trader earns 3.4 krowns per month and works with distant shores.',
    job: 'trader', slots: 1, rate: 3.4, res: 'krown',
  },
};
export const BUILD_ORDER = [
  'house', 'woodcutter', 'hunter', 'farm', 'fishery', 'mine', 'ironmine',
  'forge', 'market', 'brewery', 'altar', 'barracks', 'tower', 'tradingpost',
];

// --- Units ------------------------------------------------------------------
export const UNITS = {
  warrior: {
    id: 'warrior', name: 'Warrior', icon: '⚔️', hp: 44, dmg: 7, range: 1, speed: 1.25,
    cd: 0.75, cost: { food: 45, krown: 12 }, train: 9, warband: 1, upkFood: 0.42,
  },
  axe: {
    id: 'axe', name: 'Axe Thrower', icon: '🪓', hp: 30, dmg: 6.5, range: 2, speed: 1.2,
    cd: 1.15, cost: { food: 50, krown: 22 }, train: 11, warband: 1, upkFood: 0.42,
    requires: 'forge',
  },
  shield: {
    id: 'shield', name: 'Shield Bearer', icon: '🛡️', hp: 95, dmg: 5, range: 1, speed: 1.05,
    cd: 0.95, cost: { food: 55, krown: 26, iron: 6 }, train: 13, warband: 1, upkFood: 0.5,
    requires: 'forge',
  },
  scout: {
    id: 'scout', name: 'Scout', icon: '🧭', hp: 26, dmg: 2.5, range: 1, speed: 1.75,
    cd: 1.1, cost: { food: 25, krown: 8 }, train: 6, warband: 0, upkFood: 0.25,
  },
  warchief: {
    id: 'warchief', name: 'Warchief', icon: '👑', hp: 140, dmg: 15, range: 1, speed: 1.4,
    cd: 0.6, cost: {}, train: 0, warband: 0, upkFood: 0.6, hero: true,
  },
};
export const TRAINABLE = ['warrior', 'axe', 'shield'];
export const WARCHIEF_FAME = 120;
export const BASE_WARBAND_CAP = 4;

// --- Economy tuning ---------------------------------------------------------
export const FOOD_PER_CIV = 0.5;      // per villager per month
export const KROWN_UPKEEP = 0.05;     // per finished building per month
export const BUILD_SPAWN_SECONDS = 19; // base seconds per new villager
export const STARVE_GRACE = 12;        // seconds of starvation before losing a villager

// --- Victory ----------------------------------------------------------------
export const VICTORY = {
  fame: 300,
  krowns: 2200,
};

export const DIFFICULTY = {
  easy: {
    id: 'easy', name: 'Thrall', desc: 'A cautious jarl. Forgiving economy.',
    prod: 0.92, aggro: 6, decMag: 1.5, startBonus: 0, fameMul: 0.85,
  },
  normal: {
    id: 'normal', name: 'Karl', desc: 'A fair fight, worthy of a saga.',
    prod: 1.0, aggro: 5, decMag: 1.0, startBonus: 20, fameMul: 1.0,
  },
  hard: {
    id: 'hard', name: 'Jarl', desc: 'Ruthless. Settle fast or die.',
    prod: 1.18, aggro: 4, decMag: 0.75, startBonus: 60, fameMul: 1.1,
  },
};
