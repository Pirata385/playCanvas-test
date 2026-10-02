export enum Species {
  Rabbit,
  Deer,
  Fox,
  Wolf
}

export const SPECIES_COUNT = 4;

export interface SpeciesDef {
  name: string;
  plural: string;
  diet: 'herbivore' | 'carnivore';
  /** CSS colour used in UI and minimap. */
  color: string;
  /** Collision / interaction radius in metres (adult). */
  radius: number;
  walkSpeed: number;
  runSpeed: number;
  /** Perception radius in metres. */
  sense: number;
  lifespanDays: number;
  matureDays: number;
  hungerPerDay: number;
  thirstPerDay: number;
  /** Fraction of a full energy bar used per waking day. */
  fatiguePerDay: number;
  sleepStart: number;
  sleepEnd: number;
  litter: [number, number];
  gestationDays: number;
  mateCooldownDays: number;
  prey: Species[];
  maxPop: number;
  initial: number;
  /** Hunger restored to a predator per carcass. */
  meat: number;
  /** Hunger reduced per unit of grass eaten (herbivores). */
  nutrition: number;
  /** Seconds a predator will sustain a chase. */
  chaseSeconds: number;
}

export const SPECIES: Record<Species, SpeciesDef> = {
  [Species.Rabbit]: {
    name: 'Rabbit', plural: 'Rabbits', diet: 'herbivore', color: '#e8d6b0', radius: 0.3,
    walkSpeed: 1.6, runSpeed: 6.2, sense: 16, lifespanDays: 7, matureDays: 1.0,
    hungerPerDay: 1.5, thirstPerDay: 1.6, fatiguePerDay: 1.3, sleepStart: 21, sleepEnd: 5,
    litter: [3, 5], gestationDays: 0.5, mateCooldownDays: 0.8, prey: [], maxPop: 130, initial: 46,
    meat: 0.45, nutrition: 1.4, chaseSeconds: 0
  },
  [Species.Deer]: {
    name: 'Deer', plural: 'Deer', diet: 'herbivore', color: '#c98a4b', radius: 0.7,
    walkSpeed: 1.8, runSpeed: 8.6, sense: 26, lifespanDays: 11, matureDays: 1.6,
    hungerPerDay: 1.3, thirstPerDay: 1.4, fatiguePerDay: 1.2, sleepStart: 22, sleepEnd: 5,
    litter: [1, 2], gestationDays: 0.9, mateCooldownDays: 1.4, prey: [], maxPop: 56, initial: 22,
    meat: 1.0, nutrition: 0.8, chaseSeconds: 0
  },
  [Species.Fox]: {
    name: 'Fox', plural: 'Foxes', diet: 'carnivore', color: '#e2662c', radius: 0.4,
    walkSpeed: 2.0, runSpeed: 7.6, sense: 30, lifespanDays: 9, matureDays: 1.8,
    hungerPerDay: 0.9, thirstPerDay: 1.2, fatiguePerDay: 1.2, sleepStart: 10, sleepEnd: 15,
    litter: [2, 3], gestationDays: 0.8, mateCooldownDays: 1.3, prey: [Species.Rabbit], maxPop: 14, initial: 6,
    meat: 0.4, nutrition: 0, chaseSeconds: 16
  },
  [Species.Wolf]: {
    name: 'Wolf', plural: 'Wolves', diet: 'carnivore', color: '#8d96a8', radius: 0.6,
    walkSpeed: 2.2, runSpeed: 8.4, sense: 36, lifespanDays: 12, matureDays: 2.2,
    hungerPerDay: 0.8, thirstPerDay: 1.1, fatiguePerDay: 1.1, sleepStart: 11, sleepEnd: 16,
    litter: [1, 3], gestationDays: 1.0, mateCooldownDays: 1.6, prey: [Species.Deer, Species.Rabbit], maxPop: 10, initial: 4,
    meat: 0.6, nutrition: 0, chaseSeconds: 14
  }
};

/** Species that hunt the given species. */
export const PREDATORS_OF: Record<Species, Species[]> = {
  [Species.Rabbit]: [Species.Fox, Species.Wolf],
  [Species.Deer]: [Species.Wolf],
  [Species.Fox]: [],
  [Species.Wolf]: []
};

export enum CState {
  Idle,
  Wander,
  Graze,
  Drink,
  Hunt,
  Eat,
  Flee,
  Sleep,
  Mate,
  Follow,
  Dead
}

export const STATE_LABELS: Record<CState, string> = {
  [CState.Idle]: 'Resting',
  [CState.Wander]: 'Wandering',
  [CState.Graze]: 'Grazing',
  [CState.Drink]: 'Seeking water',
  [CState.Hunt]: 'Hunting',
  [CState.Eat]: 'Feeding',
  [CState.Flee]: 'Fleeing',
  [CState.Sleep]: 'Sleeping',
  [CState.Mate]: 'Courting',
  [CState.Follow]: 'Following parent',
  [CState.Dead]: 'Dead'
};

/** Animation hint sent to the renderer. */
export enum Anim {
  Move,
  Eat,
  Drink,
  Sleep,
  Dead,
  Mate
}
