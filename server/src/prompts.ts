import { createHash } from 'node:crypto';
import type { PromptDef } from './types.js';

const P = (id: string, cat: string, text: string, examples: string): PromptDef => ({ id, cat, text, examples });

// Every prompt is open-ended: many sensible answers, so rarity means something.
export const OUTDOOR: PromptDef[] = [
  // color
  P('o-red', 'color', 'something red', 'fire hydrant, stop sign, a red door, a cardinal'),
  P('o-yellow', 'color', 'something yellow', 'school bus, a dandelion, a taxi, a caution sign'),
  P('o-blue', 'color', 'something blue', 'a mailbox, a recycling bin, a blue jay, a painted door'),
  P('o-green-not-plant', 'color', "something green that isn't a plant", 'a bench, a street sign, a bike, a dumpster'),
  P('o-many-colors', 'color', 'something with at least three colors', 'a mural, a playground, a flag, graffiti'),
  // shape
  P('o-round', 'shape', 'something round', 'a manhole cover, a ball, a clock, a wheel'),
  P('o-triangle', 'shape', 'something triangular', 'a yield sign, a roof, a pennant, a slice of pizza'),
  P('o-spiral', 'shape', 'something curly or spiral', 'a snail shell, a fern, a coiled hose, a spiral staircase'),
  P('o-heart', 'shape', 'something heart-shaped', 'a leaf, a lock, graffiti, a cloud'),
  P('o-pointy', 'shape', 'something pointy', 'a fence spike, a pine cone, a steeple, a thorn'),
  // pattern
  P('o-squares', 'pattern', 'a pattern made of squares', 'a tiled wall, a grate, a window grid, a chessboard'),
  P('o-stripes', 'pattern', 'something striped', 'a crosswalk, an awning, a barrier, a scarf'),
  P('o-dots', 'pattern', 'a pattern of dots or holes', 'a drain cover, a perforated bench, a ladybug, a speaker grille'),
  P('o-repeat', 'pattern', 'a lot of the same thing in one place', 'bricks, parked bikes, windows, fallen leaves'),
  P('o-pair', 'pattern', 'two matching things side by side', 'twin lamps, two doors, a pair of boots, two bollards'),
  // texture
  P('o-touch', 'texture', 'a texture you want to touch', 'moss, a fuzzy plant, smooth stone, a knit scarf'),
  P('o-rough', 'texture', 'something rough', 'tree bark, a brick wall, a rock, a rusty railing'),
  P('o-shiny', 'texture', 'something shiny', 'a car bumper, a puddle, a metal sculpture, a door handle'),
  P('o-soft', 'texture', 'something soft', 'a cushion, a dog, a flower petal, a pile of leaves'),
  P('o-bumpy', 'texture', 'something bumpy', 'a tactile paving strip, a gourd, cobblestones, a tire'),
  // material
  P('o-metal', 'material', 'something made of metal', 'a bike rack, a railing, a lamp post, a mailbox'),
  P('o-wood', 'material', 'something made of wood', 'a bench, a fence, a door, a telephone pole'),
  P('o-stone', 'material', 'something made of stone', 'a curb, a statue, a wall, a pebble'),
  P('o-glass', 'material', 'something made of glass', 'a bottle, a bus shelter, a window, a lamp'),
  P('o-plastic', 'material', 'something made of plastic', 'a traffic cone, a bin, a toy, a chair'),
  // nature
  P('o-living', 'nature', "a living thing that isn't a plant or a person", 'a squirrel, a pigeon, a dog, a spider'),
  P('o-flower', 'nature', 'a flower', 'a rose, a dandelion, a daisy, a potted tulip'),
  P('o-leaf', 'nature', 'an interesting leaf', 'a maple leaf, a ginkgo leaf, a holey leaf, a frosted leaf'),
  P('o-fungus', 'nature', 'a mushroom, moss or lichen', 'moss on a wall, a bracket fungus, lichen on a rock'),
  P('o-sky', 'nature', 'something in the sky', 'a cloud, a plane, a bird, the moon'),
  P('o-water', 'nature', 'water out in the wild', 'a puddle, a fountain, a river, a frozen pond'),
  // animal
  P('o-bird', 'animal', 'a bird', 'a pigeon, a crow, a gull, a sparrow'),
  P('o-animal-trace', 'animal', 'a sign that an animal was here', 'a footprint, a nest, a feather, a chewed nut'),
  P('o-pet', 'animal', "someone's pet", 'a dog on a leash, a cat in a window, a parrot'),
  P('o-animal-art', 'animal', 'an animal that is not alive', 'a statue, a logo, a weathervane, a stuffed toy'),
  // sign
  P('o-sign-number', 'sign', 'a sign with a number on it', 'a speed limit sign, a house number, a bus stop, a price board'),
  P('o-arrow', 'sign', 'an arrow', 'a one-way sign, a road marking, an exit sign, a painted arrow'),
  P('o-warning', 'sign', 'a warning', 'a caution sign, a wet floor sign, a no parking sign, a fence notice'),
  P('o-name', 'sign', "a name that isn't yours", 'a street sign, a memorial plaque, a shop name, a boat name'),
  P('o-food-word', 'sign', 'a sign that names a food', 'a bakery sign, a menu board, a cafe chalkboard, a fruit stand'),
  // time
  P('o-older', 'time', 'something older than you', 'a stone building, a big tree, a cornerstone date, an old car'),
  P('o-new', 'time', 'something brand new', 'a fresh sign, a new bike, a just-planted tree, a sticker'),
  P('o-clock', 'time', 'something that tells time', 'a clock tower, a parking meter, a bus schedule, a sundial'),
  P('o-broken', 'time', 'something broken', 'a cracked window, a bent sign, a snapped branch, a lost umbrella'),
  P('o-season', 'time', 'a sign of the season', 'fallen leaves, frost, a scarf, a pumpkin'),
  // wheels
  P('o-wheels', 'wheels', 'something with wheels', 'a bike, a stroller, a shopping cart, a bus'),
  P('o-ride', 'wheels', 'something you can ride', 'a scooter, a swing, a bus, a skateboard'),
  P('o-parked', 'wheels', 'something parked', 'a bike, a delivery van, a stroller, a food truck'),
  // container
  P('o-holds-water', 'container', 'something that holds water', 'a puddle, a fountain, a bucket, a bird bath'),
  P('o-lid', 'container', 'something with a lid', 'a trash can, a manhole, a mailbox, a jar'),
  P('o-put-in', 'container', 'something you can put things in', 'a mailbox, a basket, a planter, a bike pannier'),
  // made
  P('o-lost', 'made', 'something someone lost', 'a single glove, a hat on a fence, a key, a toy'),
  P('o-public-art', 'made', 'art out in public', 'a mural, a statue, graffiti, a mosaic'),
  P('o-handmade', 'made', 'something handmade', 'a knitted hat, a hand-painted sign, a birdhouse, a chalk drawing'),
  P('o-door', 'made', 'an interesting door', 'a red door, an arched door, a garage door, a tiny door'),
  P('o-face', 'made', 'something that looks like a face', 'a house front, an outlet, a car front, a tree knot'),
  // light
  P('o-light', 'light', 'something that makes light', 'a street lamp, a neon sign, a traffic light, a bike light'),
  P('o-reflection', 'light', 'a reflection', 'a puddle, a car mirror, a shop window, a sunglasses lens'),
  P('o-shadow', 'light', 'an interesting shadow', 'a fence shadow, a tree shadow, a bike shadow, a shadow of a sign'),
  // use
  P('o-sit', 'use', "something you can sit on that isn't a chair", 'a bench, a step, a low wall, a rock'),
  P('o-climb', 'use', 'something you can climb', 'a tree, stairs, a playground frame, a ladder'),
  P('o-tied', 'use', 'something tied or locked up', 'a locked bike, a shoelace, a boat rope, a ribbon on a fence'),
  P('o-hanging', 'use', 'something hanging', 'a hanging sign, a flower basket, string lights, a swing'),
  P('o-noise', 'use', 'something that makes noise', 'a bell, a car horn, a wind chime, a crow'),
  // size
  P('o-bigger-car', 'size', 'something bigger than a car', 'a bus, a tree, a statue, a shipping container'),
  P('o-small', 'size', 'something smaller than a coin', 'a ladybug, a seed, a pebble, a bottle cap'),
  P('o-out-of-place', 'size', 'something out of place', 'a shoe on a fence, a chair on the sidewalk, a couch on the curb'),
];

// Quick (indoor demo) set. 'i-red' always opens a quick game.
export const INDOOR: PromptDef[] = [
  P('i-red', 'color', 'something red', 'a mug, a book cover, an apple, a fire extinguisher'),
  P('i-blue', 'color', 'something blue', 'a water bottle, a notebook, a sweater, a pen cap'),
  P('i-round', 'shape', 'something round', 'a cup, a ball, a clock, a roll of tape'),
  P('i-stripes', 'pattern', 'something striped', 'a shirt, a notebook, a sock, a barcode'),
  P('i-soft', 'texture', 'something soft', 'a scarf, a pillow, a hoodie, a plush toy'),
  P('i-shiny', 'texture', 'something shiny', 'a spoon, keys, a soda can, a mirror'),
  P('i-paper', 'material', 'something made of paper', 'a book, a receipt, a cup, a sticky note'),
  P('i-wood', 'material', 'something made of wood', 'a table, a pencil, a chopstick, a door'),
  P('i-write', 'use', 'something you can write with', 'a pen, a pencil, a marker, chalk'),
  P('i-wear', 'use', 'something you wear', 'a shoe, a hat, glasses, a watch'),
  P('i-plug', 'use', 'something that plugs in', 'a charger, a lamp, a kettle, headphones'),
  P('i-holds-water', 'container', 'something that holds water', 'a mug, a bottle, a sink, a vase'),
  P('i-number', 'sign', 'something with a number on it', 'a keyboard, a ruler, a price tag, a clock'),
  P('i-small', 'size', 'something smaller than a coin', 'a paperclip, a button, a key, a grain of rice'),
  P('i-older', 'time', 'something older than you', 'a book, a coin, a building, a family photo frame'),
  P('i-noise', 'light', 'something that makes light or sound', 'a lamp, a speaker, a phone, a bell'),
];

export const QUICK_OPENER = 'i-red';

/**
 * Impostor mode: each prompt below has a twin that is close but different. One player per round gets the twin and
 * has to find something that fits it while passing as a find for the real prompt.
 */
const twin = (of: string, text: string, examples: string) => [of, P(`t-${of}`, 'twin', text, examples)] as const;
export const TWINS: Record<string, PromptDef> = Object.fromEntries([
  // outdoor
  twin('o-red', 'something orange', 'a traffic cone, a pumpkin, a leaf, a construction sign'),
  twin('o-yellow', 'something green', 'a bench, a door, a recycling bin, a sign'),
  twin('o-blue', 'something purple', 'a flower, a car, a sweater, a sign'),
  twin('o-round', 'something oval', 'an egg, a mirror, a leaf, a sign'),
  twin('o-triangle', 'something diamond-shaped', 'a sign, a kite, a fence pattern, a tile'),
  twin('o-stripes', 'something with zigzags', 'a fence, a tire track, a pattern, a roof'),
  twin('o-shiny', 'something see-through', 'a window, a bottle, a bag, a bus shelter'),
  twin('o-soft', 'something squishy', 'a ball, moss, a cushion, mud'),
  twin('o-metal', 'something made of rubber', 'a tire, a boot, a ball, a mat'),
  twin('o-wood', 'something made of cardboard', 'a box, a cup, a sign, a tube'),
  twin('o-stone', 'something made of concrete', 'a curb, a step, a planter, a wall'),
  twin('o-flower', 'a weed', 'a dandelion, clover, a thistle, grass in a crack'),
  twin('o-leaf', 'a twig or branch', 'a fallen stick, a branch, a twig, a sapling'),
  twin('o-bird', 'a bug or insect', 'an ant, a bee, a beetle, a spider'),
  twin('o-wheels', 'something with a handle', 'a door, a bag, a shopping cart, a mug'),
  twin('o-older', 'something rusty', 'a gate, a nail, a bike chain, a sign post'),
  twin('o-sign-number', 'a sign with a picture on it', 'a crosswalk sign, a logo, a poster, a map'),
  twin('o-light', 'something that runs on batteries', 'a phone, a watch, a toy, a remote'),
  twin('o-holds-water', 'something that holds air', 'a tire, a ball, a balloon, a bag'),
  twin('o-hanging', 'something leaning', 'a bike, a ladder, a sign, a tree'),
  // indoor
  twin('i-red', 'something pink', 'a sticky note, an eraser, a shirt, a cup'),
  twin('i-blue', 'something green', 'a plant, a pen, a bottle, a book cover'),
  twin('i-round', 'something square', 'a sticky note, a tile, a coaster, a box'),
  twin('i-stripes', 'something with dots', 'a dice, a speaker grille, a shirt, a keyboard light'),
  twin('i-soft', 'something squishy', 'a stress ball, a sponge, a pillow, a gummy'),
  twin('i-shiny', 'something see-through', 'a glass, a bottle, a bag, a window'),
  twin('i-paper', 'something made of cardboard', 'a box, a cup sleeve, a tube, a folder'),
  twin('i-wood', 'something brown', 'a bag, a shoe, a table, a belt'),
  twin('i-write', 'something you can cut with', 'scissors, a knife, a ruler edge, a box cutter'),
  twin('i-wear', 'something you carry', 'a bag, keys, a phone, a bottle'),
  twin('i-plug', 'something with a battery', 'a phone, a mouse, a remote, a watch'),
  twin('i-holds-water', 'something with a lid', 'a jar, a laptop, a box, a bottle'),
  twin('i-number', 'something with letters on it', 'a keyboard, a book, a label, a shirt'),
  twin('i-small', 'something thinner than a pencil', 'a cable, a straw, a hair tie, a needle'),
  twin('i-older', 'something worn out', 'a shoe, an eraser, a book, a cable'),
  twin('i-noise', 'something that vibrates', 'a phone, a speaker, a fan, a watch'),
]);
const TWIN_BY_ID = new Map(Object.values(TWINS).map((t) => [t.id, t]));
export const twinFor = (promptId: string): PromptDef | undefined => TWINS[promptId];
const ALL = new Map([...OUTDOOR, ...INDOOR].map((p) => [p.id, p]));

export function promptById(id: string): PromptDef | undefined {
  return ALL.get(id) ?? TWIN_BY_ID.get(id);
}

/** Pick n prompts, never two from one category. rand() in [0,1). */
export function pickPrompts(pool: PromptDef[], n: number, rand: () => number, first?: string): PromptDef[] {
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out: PromptDef[] = [];
  const cats = new Set<string>();
  const opener = first ? pool.find((p) => p.id === first) : undefined;
  if (opener) {
    out.push(opener);
    cats.add(opener.cat);
  }
  for (const p of order) {
    if (out.length >= n) break;
    if (cats.has(p.cat) || out.includes(p)) continue;
    cats.add(p.cat);
    out.push(p);
  }
  return out;
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seeded(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailyPrompts(day: string): PromptDef[] {
  return pickPrompts(OUTDOOR, 5, seeded(`rarefind-daily:${day}`));
}

/** Solo quick play: one fixed set per Toronto day, the same 3 prompts for every team (opens with "something red"). */
export function soloPrompts(day: string): PromptDef[] {
  return pickPrompts(INDOOR, 3, seeded(`rarefind-quick:${day}`), QUICK_OPENER);
}

/** n: 5 for rounds, 9 for a bingo card (each pool has enough categories for 9 distinct ones). */
export function squadPrompts(quick: boolean, rand: () => number = Math.random, n = 5, twinsOnly = false): PromptDef[] {
  const only = (pool: PromptDef[]) => (twinsOnly ? pool.filter((p) => TWINS[p.id]) : pool);
  return quick ? pickPrompts(only(INDOOR), n, rand, QUICK_OPENER) : pickPrompts(only(OUTDOOR), n, rand);
}

// ---------- Toronto day ----------
const TZ = 'America/Toronto';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function parts(ms: number) {
  const o: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

export function torontoDay(ms = Date.now()): string {
  const p = parts(ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Epoch ms of the next midnight in Toronto. */
export function nextTorontoMidnight(ms = Date.now()): number {
  const p = parts(ms);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  let guess = Date.UTC(p.year, p.month - 1, p.day + 1) - offset;
  // DST change overnight: correct by the offset at the guess
  const q = parts(guess);
  const off2 = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - guess;
  if (off2 !== offset) guess = Date.UTC(p.year, p.month - 1, p.day + 1) - off2;
  return guess;
}
